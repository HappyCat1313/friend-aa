// uses `aa-testkit` testing framework for AA tests. Docs can be found here `https://github.com/valyakin/aa-testkit`
// `mocha` standard functions and `expect` from `chai` are available globally
// `Testkit`, `Network`, `Nodes` and `Utils` from `aa-testkit` are available globally too
const path = require('path')
const { promisify } = require('util')
const fs = require('fs')
const objectHash = require("ocore/object_hash.js");
const parseOjson = require('ocore/formula/parse_ojson').parse

async function getAaAddress(aa_src) {
	return objectHash.getChash160(await promisify(parseOjson)(aa_src));
}

function wait(ms) {
	return new Promise(r => setTimeout(r, ms))
}

describe('Friends', function () {
	this.timeout(240000)

	before(async () => {

		// oswap stuff
		const pool_lib = fs.readFileSync(path.join(__dirname, '../node_modules/oswap-v2-aa/pool-lib.oscript'), 'utf8');
		const pool_lib_address = await getAaAddress(pool_lib);
		const pool_lib_by_price = fs.readFileSync(path.join(__dirname, '../node_modules/oswap-v2-aa/pool-lib-by-price.oscript'), 'utf8');
		const pool_lib_by_price_address = await getAaAddress(pool_lib_by_price);
		let pool_base = fs.readFileSync(path.join(__dirname, '../node_modules/oswap-v2-aa/pool.oscript'), 'utf8');
		pool_base = pool_base.replace(/\$pool_lib_aa = '\w{32}'/, `$pool_lib_aa = '${pool_lib_address}'`)
		pool_base = pool_base.replace(/\$pool_lib_by_price_aa = '\w{32}'/, `$pool_lib_by_price_aa = '${pool_lib_by_price_address}'`)
		const pool_base_address = await getAaAddress(pool_base);
		let factory = fs.readFileSync(path.join(__dirname, '../node_modules/oswap-v2-aa/factory.oscript'), 'utf8');
		factory = factory.replace(/\$pool_base_aa = '\w{32}'/, `$pool_base_aa = '${pool_base_address}'`)

		this.network = await Network.create()
			.with.numberOfWitnesses(1)
			.with.asset({ usdc: {} })
			.with.agent({ governance_base: path.join(__dirname, '../governance.oscript') })
			.with.agent({ rewards_aa: path.join(__dirname, '../rewards.oscript') })
			.with.agent({ rewards2_aa: path.join(__dirname, '../rewards2.oscript') })

			.with.agent({ lbc: path.join(__dirname, '../node_modules/oswap-v2-aa/linear-bonding-curve.oscript') })
			.with.agent({ pool_lib: path.join(__dirname, '../node_modules/oswap-v2-aa/pool-lib.oscript') })
			.with.agent({ pool_lib_by_price: path.join(__dirname, '../node_modules/oswap-v2-aa/pool-lib-by-price.oscript') })
			.with.agent({ pool_base })
			.with.agent({ oswap_governance_base: path.join(__dirname, '../node_modules/oswap-v2-aa/governance.oscript') })
			.with.agent({ factory })

			.with.wallet({ alice: {base: 1000e9, usdc: 10000e4} })
			.with.wallet({ bob: 1000e9 })
			.with.wallet({ carol: 1000e9 })
			.with.wallet({ dave: 1000e9 })
			.with.wallet({ eve: 1000e9 })
			.with.wallet({ fred: 1000e9 })
			.with.wallet({ admin: 1e9 })
			.with.wallet({ messagingAttestor: 1e9 })
			.with.wallet({ realNameAttestor: 1e9 })
		//	.with.explorer()
			.run()
		
		this.alice = this.network.wallet.alice
		this.aliceAddress = await this.alice.getAddress()

		this.bob = this.network.wallet.bob
		this.bobAddress = await this.bob.getAddress()
		
		this.carol = this.network.wallet.carol
		this.carolAddress = await this.carol.getAddress()
		
		this.dave = this.network.wallet.dave
		this.daveAddress = await this.dave.getAddress()
		
		this.eve = this.network.wallet.eve
		this.eveAddress = await this.eve.getAddress()
		
		this.fred = this.network.wallet.fred
		this.fredAddress = await this.fred.getAddress()
		
		this.admin = this.network.wallet.admin
		this.adminAddress = await this.admin.getAddress()
		
		this.messagingAttestor = this.network.wallet.messagingAttestor
		this.messagingAttestorAddress = await this.messagingAttestor.getAddress()
		
		this.realNameAttestor = this.network.wallet.realNameAttestor
		this.realNameAttestorAddress = await this.realNameAttestor.getAddress()

		this.rewards_aa_address = await this.network.agent.rewards_aa
		this.rewards2_aa_address = await this.network.agent.rewards2_aa

		this.usdc = this.network.asset.usdc

		this.timetravel = async (shift = '1d') => {
			const { error, timestamp } = await this.network.timetravel({ shift })
			expect(error).to.be.null
			return Math.round(timestamp / 1000)
		}

		this.timetravelToDate = async (to) => {
			const { error, timestamp } = await this.network.timetravel({ to })
			expect(error).to.be.null
		}

		this.executeGetter = async (aa, getter, args = []) => {
			const { result, error } = await this.alice.executeGetter({
				aaAddress: aa,
				getter,
				args
			})
			if (error)
				console.log(error)
			expect(error).to.be.null
			return result
		}

		this.get_price = async (asset_label, bAfterInterest = true) => {
			return await this.executeGetter(this.pool_aa, 'get_price', [asset_label, 0, 0, bAfterInterest])
		}

		this.deposit_asset_reducer = 0.5
		this.bytes_reducer = 0.75

	})


	it('Deploy Friend AA', async () => {
		let friend = fs.readFileSync(path.join(__dirname, '../friend.oscript'), 'utf8');
		friend = friend.replace(/rewards_aa: '\w*'/, `rewards_aa: '${this.rewards_aa_address}'`)
		friend = friend.replace(/messaging_attestors: '[\w:]*'/, `messaging_attestors: '${this.messagingAttestorAddress}'`)
		friend = friend.replace(/real_name_attestors: '[\w:]*'/, `real_name_attestors: '${this.realNameAttestorAddress}'`)
		friend = friend.replace(/ghost_admin = '\w*'/, `ghost_admin = '${this.adminAddress}'`)

		const { address, error } = await this.alice.deployAgent(friend)
		console.log(error)
		expect(error).to.be.null
		this.friend_aa = address
	})

	it('Alice defines the token', async () => {
		const { error: tf_error } = await this.network.timefreeze()
		expect(tf_error).to.be.null

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				define: 1
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
	//	await this.network.witnessUntilStable(response.response_unit)

		this.asset = response.response.responseVars.asset

		const { vars } = await this.alice.readAAStateVars(this.friend_aa)
		this.governance_aa = vars.constants.governance_aa
		this.launch_ts = vars.constants.launch_ts
		expect(this.governance_aa).to.be.validAddress
		expect(this.launch_ts).to.be.eq(response.timestamp)
	})


	it('Alice tries to deposit while not being messaging-attested', async () => {
		const amount = 1e9
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: amount,
			data: {
				deposit: 1
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.validUnit
		expect(response.response.error).to.eq("your address must be attested on a messaging service")
	})

	
	it('Attest alice for messaging', async () => {
		const { unit, error } = await this.messagingAttestor.sendMulti({
			messages: [{
				app: 'attestation',
				payload: {
					address: this.aliceAddress,
					profile: {
						username: 'alice',
						userId: '123',
					},
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)
	})


	it('Alice tries to deposit while not being real-name attested', async () => {
		const amount = 1e9
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: amount,
			data: {
				deposit: 1
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.validUnit
		expect(response.response.error).to.eq("your address must be real-name attested or you should deposit at least 500 FRD")
	})


	it('Attest the real name of alice', async () => {
		const { unit, error } = await this.realNameAttestor.sendMulti({
			messages: [{
				app: 'attestation',
				payload: {
					address: this.aliceAddress,
					profile: {
						user_id: 'aaaa',
					},
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)
	})


	it('Alice tries to deposit while indicating herself as referrer', async () => {
		const amount = 1e9
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: amount,
			data: {
				deposit: 1,
				ref: this.aliceAddress,
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.validUnit
		expect(response.response.error).to.eq("referrer doesn't exist")
	})


	it('Alice deposits', async () => {
		const amount = 1e9
		console.log(`paying ${amount/1e9} GB`)

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: amount + 10_000,
			data: {
				deposit: 1
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null
		expect(response.response.responseVars.message).to.eq("Deposited")
		const unlock_date = new Date((response.timestamp + 365 * 24 * 3600) * 1000).toISOString().substring(0, 10)
		expect(response.response.responseVars.unlock_date).to.eq(unlock_date)

		this.total_locked_bytes = amount
		this.alice_profile = {
			balances: {
				frd: 0,
				base: amount,
			},
			unlock_date,
			reg_ts: response.timestamp,
			current_ghost_num: 1,
		}

		const { vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(vars['user_' + this.aliceAddress]).to.deep.eq(this.alice_profile)
		expect(vars.total_locked).to.eq(0)
		expect(vars.total_locked_bytes).to.eq(this.total_locked_bytes)
	})


	it('Admin defines a Satoshi ghost', async () => {
		const ghost_name = 'Satoshi Nakamoto'
		this.satoshi_name = ghost_name

		const { unit, error } = await this.admin.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10_000,
			data: {
				add_ghost: 1,
				ghost_name,
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.admin, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null
		expect(response.response.responseVars.message).to.eq("Added the new ghost account")

		const today = new Date(response.timestamp * 1000).toISOString().substring(0, 10)
		this.satoshi_profile = {
			balances: {
				frd: 100e9,
			},
			unlock_date: false,
			reg_ts: response.timestamp,
			ghost: true,
			last_date: today,
		}

		const { vars } = await this.admin.readAAStateVars(this.friend_aa)
		expect(vars['user_' + ghost_name]).to.deep.eq(this.satoshi_profile)
		expect(vars.total_locked).to.eq(0)
		expect(vars.total_locked_bytes).to.eq(this.total_locked_bytes)
	})


	it('Bob defines a new pool', async () => {
		this.x_asset = 'base'
		this.y_asset = this.usdc
		this.base_interest_rate = 0.1
		this.swap_fee = 0.003
		this.exit_fee = 0.005
		this.leverage_profit_tax = 0.1
		this.arb_profit_tax = 0.9
		this.alpha = 0.5
		this.beta = 1 - this.alpha
		this.pool_leverage = 10
		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.network.agent.factory,
			amount: 10000,
			data: {
				x_asset: this.x_asset,
				y_asset: this.y_asset,
				swap_fee: this.swap_fee,
				exit_fee: this.exit_fee,
				leverage_profit_tax: this.leverage_profit_tax,
				arb_profit_tax: this.arb_profit_tax,
				base_interest_rate: this.base_interest_rate,
				alpha: this.alpha,
				mid_price: this.mid_price,
				price_deviation: this.price_deviation,
				pool_leverage: this.pool_leverage,
			},
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.bob, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
	//	await this.network.witnessUntilStable(response.response_unit)

		this.pool_aa = response.response.responseVars.address
		expect(this.pool_aa).to.be.validAddress

		const { vars } = await this.bob.readAAStateVars(this.pool_aa)
		this.shares_asset = vars.lp_shares.asset
		expect(this.shares_asset).to.be.validUnit

		this.linear_shares = 0
		this.issued_shares = 0
		this.coef = 1
		this.balances = { x: 0, y: 0, xn: 0, yn: 0 }
		this.profits = { x: 0, y: 0 }
		this.leveraged_balances = {}

		this.bounce_fees = this.x_asset !== 'base' && { base: [{ address: this.pool_aa, amount: 1e4 }] }
		this.bounce_fee_on_top = this.x_asset === 'base' ? 1e4 : 0
	})
	
	
	it('Alice adds liquidity', async () => {
		const x_amount = 1e9
		const y_amount = 100e4
		this.initial_price = this.alpha / this.beta * y_amount / x_amount
		const new_linear_shares = this.mid_price
			? Math.round(x_amount * this.mid_price ** this.beta * this.price_deviation / (this.price_deviation - 1))
			: Math.round(x_amount ** this.alpha * y_amount ** this.beta)
		this.balances.x += x_amount * this.pool_leverage
		this.balances.y += y_amount * this.pool_leverage
		this.balances.xn += x_amount
		this.balances.yn += y_amount
		const new_issued_shares = new_linear_shares
		this.linear_shares += new_linear_shares
		this.issued_shares += new_issued_shares
		const { unit, error } = await this.alice.sendMulti({
			outputs_by_asset: {
				[this.x_asset]: [{ address: this.pool_aa, amount: x_amount + this.bounce_fee_on_top }],
				[this.y_asset]: [{ address: this.pool_aa, amount: y_amount }],
				...this.bounce_fees
			},
			messages: [{
				app: 'data',
				payload: {
					buy_shares: 1,
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
	//	await this.network.witnessUntilStable(response.response_unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.shares_asset,
				address: this.aliceAddress,
				amount: new_issued_shares,
			},
		])

		this.recent = {
			last_ts: response.timestamp,
		}

		const { vars } = await this.alice.readAAStateVars(this.pool_aa)
		expect(vars.lp_shares.issued).to.be.eq(this.issued_shares)
		expect(vars.lp_shares.linear).to.be.eq(this.linear_shares)
		expect(vars.lp_shares.coef).to.be.eq(this.coef)
		expect(vars.balances).to.be.deep.eq(this.balances)
		expect(vars.leveraged_balances).to.be.deep.eq(this.leveraged_balances)
		expect(vars.profits).to.be.deep.eq(this.profits)
		expect(vars.recent).to.be.deep.eq(this.recent)
	})


	it("Alice votes for adding USDC before any trades in the pool", async () => {
		const name = 'deposit_asset'
		const deposit_asset = this.usdc
		const value = this.pool_aa
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 10000,
			data: {
				name,
				deposit_asset,
				value,
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		expect(response.response.error).to.include("no recent state of the pool")
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.null
	})


	it('Alice swaps', async () => {
		// get the initial price
		const initial_price = await this.get_price('x')
		console.log({ initial_price })

		const final_price = initial_price * 1.1
		const result = await this.executeGetter(this.pool_aa, 'get_swap_amounts_by_final_price', ['y', final_price])
		const { in: y_amount, out: net_x_amount, arb_profit_tax, fees } = result
		const x_amount = net_x_amount + fees.out

		const { unit, error } = await this.alice.sendMulti({
			outputs_by_asset: {
				base: [{address: this.pool_aa, amount: 1e4}],
				[this.y_asset]: [{address: this.pool_aa, amount: y_amount}],
			},
			messages: [{
				app: 'data',
				payload: {
					final_price: final_price,
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
	//	await this.network.witnessUntilStable(response.response_unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		this.recent.prev = false
		this.recent.current = {
			start_ts: Math.floor(response.timestamp / 3600) * 3600,
			pmin: this.initial_price,
			pmax: final_price,
		}
		this.recent.last_trade = {
			address: this.aliceAddress,
			pmin: this.initial_price,
			pmax: final_price,
			amounts: { x: x_amount, y: 0 },
			paid_taxes: { x: arb_profit_tax, y: 0 },
		}
		const { vars } = await this.alice.readAAStateVars(this.pool_aa)
		expect(vars.recent).to.be.deepCloseTo(this.recent, 0.000001)
	})


	it('Alice swaps again 1 hour later', async () => {
		await this.timetravel('1h')
		// get the initial price
		const initial_price = await this.get_price('x')
		console.log({ initial_price })

		const final_price = initial_price * 1.1
		const result = await this.executeGetter(this.pool_aa, 'get_swap_amounts_by_final_price', ['y', final_price])
		const { in: y_amount, out: net_x_amount, arb_profit_tax, fees } = result
		const x_amount = net_x_amount + fees.out

		const { unit, error } = await this.alice.sendMulti({
			outputs_by_asset: {
				base: [{address: this.pool_aa, amount: 1e4}],
				[this.y_asset]: [{address: this.pool_aa, amount: y_amount}],
			},
			messages: [{
				app: 'data',
				payload: {
					final_price: final_price,
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
	//	await this.network.witnessUntilStable(response.response_unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		this.recent.prev = this.recent.current
		this.recent.current = {
			start_ts: Math.floor(response.timestamp / 3600) * 3600,
			pmin: initial_price,
			pmax: final_price,
		}
		this.recent.last_trade = {
			address: this.aliceAddress,
			pmin: initial_price,
			pmax: final_price,
			amounts: { x: x_amount, y: 0 },
			paid_taxes: { x: arb_profit_tax, y: 0 },
		}
		this.recent.last_ts = response.timestamp
		const { vars } = await this.alice.readAAStateVars(this.pool_aa)
		expect(vars.recent).to.be.deepCloseTo(this.recent, 0.000001)
	})


	it("Alice votes for adding USDC", async () => {
		const timestamp = await this.timetravel('0d')
		const ceiling_price = 2 ** ((timestamp - this.launch_ts) / 365 / 24 / 3600)
		const balance = this.alice_profile.balances.base / ceiling_price + this.alice_profile.balances.frd
		const sqrt_balance = +Math.sqrt(balance).toPrecision(15)

		const name = 'deposit_asset'
		const deposit_asset = this.usdc
		const full_name = name + '_' + deposit_asset
		const value = this.pool_aa
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 10000,
			data: {
				name,
				deposit_asset,
				value,
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null

		this.aliceVotes = {
			[full_name]: {
				value,
				sqrt_balance,
			},
		}

		const { vars: friend_vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(friend_vars['variables']).to.be.undefined

		const { vars } = await this.alice.readAAStateVars(this.governance_aa)
		expect(vars['support_' + full_name + '_' + value]).to.be.closeTo(sqrt_balance, 0.00001)
		expect(vars['leader_' + full_name]).to.eq(value)
		expect(vars['challenging_period_start_ts_' + full_name]).to.eq(response.timestamp)
		expect(vars['choice_' + this.aliceAddress + '_' + full_name]).to.eq(value)
		expect(vars['votes_' + this.aliceAddress]).to.be.deepCloseTo(this.aliceVotes, 0.00001)
	})


	it("Alice commits the new deposit asset", async () => {
		await this.timetravel('4d')
		const name = 'deposit_asset'
		const deposit_asset = this.usdc
		const full_name = name + '_' + deposit_asset
		const value = this.pool_aa
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 10_000,
			data: {
				name,
				deposit_asset,
				commit: 1,
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.alice.readAAStateVars(this.governance_aa)
		expect(vars[name]).to.be.undefined
		expect(vars[full_name]).to.be.eq(value)

		const { vars: friend_vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(friend_vars.variables).to.be.undefined
		expect(friend_vars['deposit_asset_' + deposit_asset]).to.eq(this.pool_aa)
	})


	it('Alice deposits USDC', async () => {
		const amount = 1000e4
		console.log(`paying ${amount/1e4} USDC`)

		const { unit, error } = await this.alice.sendMulti({
			outputs_by_asset: {
				[this.usdc]: [{ address: this.friend_aa, amount: amount }],
				base: [{ address: this.friend_aa, amount: 10_000 }],
			},
			messages: [{
				app: 'data',
				payload: {
					deposit: 1,
					deposit_asset: this.usdc,
				}
			}],
			spend_unconfirmed: 'all',
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null
		expect(response.response.responseVars.message).to.eq("Deposited")
		const unlock_date = new Date((response.timestamp + 365 * 24 * 3600) * 1000).toISOString().substring(0, 10)
		expect(response.response.responseVars.unlock_date).to.eq(unlock_date)

		this.alice_profile.balances[this.usdc] = amount
		this.alice_profile.unlock_date = unlock_date
		this.ts = response.timestamp

		const { vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(vars['user_' + this.aliceAddress]).to.deep.eq(this.alice_profile)
		expect(vars.total_locked).to.eq(0)
		expect(vars.total_locked_bytes).to.eq(this.total_locked_bytes)
	})


	it('Attest bob for messaging', async () => {
		const { unit, error } = await this.messagingAttestor.sendMulti({
			messages: [{
				app: 'attestation',
				payload: {
					address: this.bobAddress,
					profile: {
						username: 'bob',
						userId: '456',
					},
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)
	})


	it('Bob deposits 505 GB without real-name attestation', async () => {
		const amount = 505e9
		console.log(`paying ${amount/1e9} GB`)

		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: amount + 10_000,
			data: {
				deposit: 1
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.bob, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null
		expect(response.response.responseVars.message).to.eq("Deposited")
		const unlock_date = new Date((response.timestamp + 365 * 24 * 3600) * 1000).toISOString().substring(0, 10)
		expect(response.response.responseVars.unlock_date).to.eq(unlock_date)

		this.total_locked_bytes += amount
		this.bob_profile = {
			balances: {
				frd: 0,
				base: amount,
			},
			unlock_date,
			reg_ts: response.timestamp,
			current_ghost_num: 1,
		}

		const { vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(vars['user_' + this.bobAddress]).to.deep.eq(this.bob_profile)
		expect(vars.total_locked).to.eq(0)
		expect(vars.total_locked_bytes).to.eq(this.total_locked_bytes)
	})


	it('Alice and Bob become friends', async () => {
		const timestamp = await this.timetravel('0d')
		const ceiling_price = 2 ** ((timestamp - this.launch_ts) / 365 / 24 / 3600)

		const isAB = this.aliceAddress < this.bobAddress
		const pair = isAB ? this.aliceAddress + '_' + this.bobAddress : this.bobAddress + '_' + this.aliceAddress

		const byte_exchange_rate_in_usdc = Math.max(this.recent.current.pmax, this.recent.prev.pmax)
		const usdc_exchange_rate_in_bytes = 1 / byte_exchange_rate_in_usdc

		const alice_balance = (this.alice_profile.balances.base * this.bytes_reducer + this.alice_profile.balances[this.usdc] * usdc_exchange_rate_in_bytes * this.deposit_asset_reducer) / ceiling_price
		const bob_balance = this.bob_profile.balances.base * this.bytes_reducer / ceiling_price
		const new_user_reward = Math.floor(Math.min(10e9, alice_balance, bob_balance))
		const alice_liquid = Math.floor(alice_balance * 0.001)
		const alice_locked = Math.floor(alice_balance * 0.01) + new_user_reward
		const bob_liquid = Math.floor(bob_balance * 0.001)
		const bob_locked = Math.floor(bob_balance * 0.01) + new_user_reward
		const alice_rewards = `liquid ${alice_liquid/1e9} FRD, locked ${alice_locked/1e9} FRD, including new user reward ${new_user_reward/1e9} FRD`
		const bob_rewards = `liquid ${bob_liquid/1e9} FRD, locked ${bob_locked/1e9} FRD, including new user reward ${new_user_reward/1e9} FRD`
		const aliceRewards = {
			locked: alice_locked,
			liquid: alice_liquid,
			new_user_reward,
			is_new: true,
		}
		const bobRewards = {
			locked: bob_locked,
			liquid: bob_liquid,
			new_user_reward,
			is_new: true,
		}
		const rewards = {
			a: isAB ? aliceRewards : bobRewards,
			b: isAB ? bobRewards : aliceRewards,
		}

		// alice sends friend request
		const { unit: alice_unit, error: alice_error } = await this.alice.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				connect: 1,
				friend: this.bobAddress,
			},
		})
		expect(alice_error).to.be.null
		expect(alice_unit).to.be.validUnit

		const { response: alice_response } = await this.network.getAaResponseToUnitOnNode(this.alice, alice_unit)
		console.log(alice_response.response.error)
		expect(alice_response.response.error).to.be.undefined
		expect(alice_response.bounced).to.be.false
		expect(alice_response.response_unit).to.be.null
		expect(alice_response.response.responseVars.message).to.eq(`Registered your request. Your friend must send their request within 10 minutes, otherwise you both will have to start over. Expected rewards: ${alice_rewards}.`)

		const { vars: alice_vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(alice_vars['friendship_' + pair]).to.deep.eq({
			followup_reward_share: 0.1,
			initial: {
				first: this.aliceAddress,
				ts: alice_response.timestamp,
			}
		})

		// bob sends friend request
		const { unit: bob_unit, error: bob_error } = await this.bob.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				connect: 1,
				friend: this.aliceAddress,
			},
		})
		expect(bob_error).to.be.null
		expect(bob_unit).to.be.validUnit


		const { response: bob_response } = await this.network.getAaResponseToUnitOnNode(this.bob, bob_unit)
		expect(bob_response.response.error).to.be.undefined
		expect(bob_response.bounced).to.be.false
		expect(bob_response.response_unit).to.be.validUnit
		expect(bob_response.response.responseVars.message).to.eq(`Now you've become friends and you've received the following rewards: ${bob_rewards}.`)

		const { vars: bob_vars } = await this.bob.readAAStateVars(this.friend_aa)
		expect(bob_vars['friendship_' + pair]).to.deep.eq({
			followup_reward_share: 0.1,
			initial: {
			//	first: this.aliceAddress,
			//	ts: alice_response.timestamp,
				accept_ts: bob_response.timestamp,
				rewards,
			}
		})
		const today = new Date(bob_response.timestamp * 1000).toISOString().substring(0, 10)
		this.alice_profile.balances.frd = alice_locked
		this.alice_profile.new_user_rewards = new_user_reward
		this.alice_profile.locked_rewards = alice_locked
		this.alice_profile.liquid_rewards = alice_liquid
		this.alice_profile.last_date = today
		this.alice_profile.total_streak = 1
		this.alice_profile.current_streak = 1
		this.bob_profile.balances.frd = bob_locked
		this.bob_profile.new_user_rewards = new_user_reward
		this.bob_profile.locked_rewards = bob_locked
		this.bob_profile.liquid_rewards = bob_liquid
		this.bob_profile.last_date = today
		this.bob_profile.total_streak = 1
		this.bob_profile.current_streak = 1
		this.bob_liquid = bob_liquid
		this.total_locked = alice_locked + bob_locked
		this.total_new_user_rewards = 2 * new_user_reward
		expect(bob_vars['user_' + this.aliceAddress]).to.deep.eq(this.alice_profile)
		expect(bob_vars['user_' + this.bobAddress]).to.deep.eq(this.bob_profile)
		
		expect(bob_vars['friend_' + this.aliceAddress + '_' + today]).to.be.eq(this.bobAddress)
		expect(bob_vars['friend_' + this.bobAddress + '_' + today]).to.be.eq(this.aliceAddress)
		expect(bob_vars['total_new_user_rewards']).to.be.eq(this.total_new_user_rewards)
		expect(bob_vars['total_referral_rewards']).to.undefined
		expect(bob_vars['total_locked']).to.eq(this.total_locked)

		const { unitObj } = await this.bob.getUnitInfo({ unit: bob_response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.asset,
				address: this.aliceAddress,
				amount: alice_liquid,
			},
			{
				asset: this.asset,
				address: this.bobAddress,
				amount: bob_liquid,
			},
		])

	})


	it('Alice and Bob try to become friends again on the same day', async () => {

		// alice sends friend request
		const { unit: alice_unit, error: alice_error } = await this.alice.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				connect: 1,
				friend: this.bobAddress,
			},
		})
		expect(alice_error).to.be.null
		expect(alice_unit).to.be.validUnit

		const { response: alice_response } = await this.network.getAaResponseToUnitOnNode(this.alice, alice_unit)
		expect(alice_response.response.error).to.be.eq("you already made a friend today, try tomorrow")
		expect(alice_response.bounced).to.be.true
		expect(alice_response.response_unit).to.be.null

	})


	it('Alice and Bob try to become friends again on the next day', async () => {
		await this.timetravel('1d')

		// alice sends friend request
		const { unit: alice_unit, error: alice_error } = await this.alice.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				connect: 1,
				friend: this.bobAddress,
			},
		})
		expect(alice_error).to.be.null
		expect(alice_unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, alice_unit)
		const unlock_date = new Date((response.timestamp + 365 * 24 * 3600) * 1000).toISOString().substring(0, 10)
		expect(response.response.error).to.be.eq(`your unlock date must be ${unlock_date} or later`)
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.null

	})


	it('Alice extends the term', async () => {
		const term = 500

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10_000,
			data: {
				deposit: 1,
				term,
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null
		expect(response.response.responseVars.message).to.be.undefined
		const unlock_date = new Date((response.timestamp + term * 24 * 3600) * 1000).toISOString().substring(0, 10)
		expect(response.response.responseVars.unlock_date).to.eq(unlock_date)

		this.alice_profile.unlock_date = unlock_date

		const { vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(vars['user_' + this.aliceAddress]).to.deep.eq(this.alice_profile)
		expect(vars.total_locked).to.eq(this.total_locked)
		expect(vars.total_locked_bytes).to.eq(this.total_locked_bytes)
	})


	it('Bob extends the term', async () => {
		const term = 500

		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10_000,
			data: {
				deposit: 1,
				term,
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.bob, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null
		expect(response.response.responseVars.message).to.be.undefined
		const unlock_date = new Date((response.timestamp + term * 24 * 3600) * 1000).toISOString().substring(0, 10)
		expect(response.response.responseVars.unlock_date).to.eq(unlock_date)

		this.bob_profile.unlock_date = unlock_date

		const { vars } = await this.bob.readAAStateVars(this.friend_aa)
		expect(vars['user_' + this.bobAddress]).to.deep.eq(this.bob_profile)
		expect(vars.total_locked).to.eq(this.total_locked)
		expect(vars.total_locked_bytes).to.eq(this.total_locked_bytes)
	})


	it('Alice and Bob try to become friends again on the next day', async () => {
		// alice sends friend request
		const { unit: alice_unit, error: alice_error } = await this.alice.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				connect: 1,
				friend: this.bobAddress,
			},
		})
		expect(alice_error).to.be.null
		expect(alice_unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, alice_unit)
		expect(response.response.error).to.be.eq("you are already friends")
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.null
	})


	it("Alice votes for changing the messaging attestors", async () => {
		const timestamp = await this.timetravel('0d')
		const ceiling_price = 2 ** ((timestamp - this.launch_ts) / 365 / 24 / 3600)
		const balance = this.alice_profile.balances.base / ceiling_price + this.alice_profile.balances.frd
		const sqrt_balance = +Math.sqrt(balance).toPrecision(15)

		const name = 'messaging_attestors'
		const value = this.messagingAttestorAddress + ':' + this.bobAddress
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 10000,
			data: {
				name,
				value,
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null

		this.aliceVotes.messaging_attestors = {
				value,
				sqrt_balance,
			}

		const { vars: friend_vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(friend_vars['variables']).to.be.undefined

		const { vars } = await this.alice.readAAStateVars(this.governance_aa)
		expect(vars['support_' + name + '_' + value]).to.be.closeTo(sqrt_balance, 0.00001)
		expect(vars['leader_' + name]).to.eq(value)
		expect(vars['challenging_period_start_ts_' + name]).to.eq(response.timestamp)
		expect(vars['choice_' + this.aliceAddress + '_' + name]).to.eq(value)
		expect(vars['votes_' + this.aliceAddress]).to.deepCloseTo(this.aliceVotes, 0.00001)

	})


	it("Alice commits the new messaging attestors", async () => {
		await this.timetravel('4d')
		const name = 'messaging_attestors'
		const value = this.messagingAttestorAddress + ':' + this.bobAddress
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 10000,
			data: {
				name,
				commit: 1,
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.alice.readAAStateVars(this.governance_aa)
		expect(vars[name]).to.eq(value)

		this.variables = {
			rewards_aa: this.rewards_aa_address,
			messaging_attestors: value,
			real_name_attestors: this.realNameAttestorAddress,
			referrer_deposit_reward_share: 0.01,
			followup_reward_share: 0.1,
			min_balance_instead_of_real_name: 500e9,
		}
		const { vars: friend_vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(friend_vars.variables).to.deep.eq(this.variables)

	})


	it('Bob sends some FRD to Carol, Dave, Eve, and Fred', async () => {
		const amount = Math.floor(this.bob_liquid / 2 / 4)
		const { unit, error } = await this.bob.sendMulti({
			outputs_by_asset: {
				[this.asset]: [
					{ address: this.carolAddress, amount: amount },
					{ address: this.daveAddress, amount: amount },
					{ address: this.eveAddress, amount: amount },
					{ address: this.fredAddress, amount: amount },
				],
			},
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		this.carol_liquid = amount
		this.dave_liquid = amount
		this.eve_liquid = amount
		this.fred_liquid = amount
		this.bob_liquid -= 4 * amount
	})


	it('Attest carol for messaging, Bob is the attestor', async () => {
		const { unit, error } = await this.bob.sendMulti({
			messages: [{
				app: 'attestation',
				payload: {
					address: this.carolAddress,
					profile: {
						username: 'carol',
					},
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)
	})


	it('Attest the real name of carol', async () => {
		const { unit, error } = await this.realNameAttestor.sendMulti({
			messages: [{
				app: 'attestation',
				payload: {
					address: this.carolAddress,
					profile: {
						user_id: 'cccccc',
					},
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)
	})


	it('Attest Dave for messaging, Bob is the attestor', async () => {
		const { unit, error } = await this.bob.sendMulti({
			messages: [{
				app: 'attestation',
				payload: {
					address: this.daveAddress,
					profile: {
						username: 'dave',
					},
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)
	})


	it('Attest the real name of Dave', async () => {
		const { unit, error } = await this.realNameAttestor.sendMulti({
			messages: [{
				app: 'attestation',
				payload: {
					address: this.daveAddress,
					profile: {
						user_id: 'ddddd',
					},
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)
	})


	it('Attest Eve for messaging, Bob is the attestor', async () => {
		const { unit, error } = await this.bob.sendMulti({
			messages: [{
				app: 'attestation',
				payload: {
					address: this.eveAddress,
					profile: {
						username: 'eve',
					},
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)
	})


	it('Attest the real name of Eve', async () => {
		const { unit, error } = await this.realNameAttestor.sendMulti({
			messages: [{
				app: 'attestation',
				payload: {
					address: this.eveAddress,
					profile: {
						user_id: 'eeee',
					},
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)
	})


	it('Attest Fred for messaging, messaging attestor is the attestor', async () => {
		const { unit, error } = await this.messagingAttestor.sendMulti({
			messages: [{
				app: 'attestation',
				payload: {
					address: this.fredAddress,
					profile: {
						username: 'fred',
					},
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)
	})


	it('Attest the real name of Fred', async () => {
		const { unit, error } = await this.realNameAttestor.sendMulti({
			messages: [{
				app: 'attestation',
				payload: {
					address: this.fredAddress,
					profile: {
						user_id: 'fffff',
					},
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)
	})


	it('Carol deposits with Bob as referrer', async () => {
		const term = 500
		const amount = this.carol_liquid
		console.log(`paying ${amount/1e9} FRD`)

		const { unit, error } = await this.carol.sendMulti({
			outputs_by_asset: {
				[this.asset]: [{ address: this.friend_aa, amount: amount }],
				base: [{ address: this.friend_aa, amount: 10_000 }],
			},
			messages: [{
				app: 'data',
				payload: {
					deposit: 1,
					term,
					ref: this.bobAddress,
				}
			}],
			spend_unconfirmed: 'all',
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.carol, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(response.response.responseVars.message).to.eq("Deposited")
		const unlock_date = new Date((response.timestamp + term * 24 * 3600) * 1000).toISOString().substring(0, 10)
		expect(response.response.responseVars.unlock_date).to.eq(unlock_date)

		this.total_locked += amount
		this.carol_profile = {
			balances: {
				frd: amount,
				base: 0,
			},
			unlock_date,
			reg_ts: response.timestamp,
			current_ghost_num: 1,
			ref: this.bobAddress,
		}
		this.ts = response.timestamp

		const { vars } = await this.carol.readAAStateVars(this.friend_aa)
		expect(vars['user_' + this.carolAddress]).to.deep.eq(this.carol_profile)
		expect(vars.total_locked).to.eq(this.total_locked)
		expect(vars.total_locked_bytes).to.eq(this.total_locked_bytes)

		const ref_deposit_reward = Math.floor(amount * 0.01)
		this.bob_liquid += ref_deposit_reward

		const { unitObj } = await this.carol.getUnitInfo({ unit: response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.asset,
				address: this.bobAddress,
				amount: ref_deposit_reward,
			},
		])

	})


	it('Dave deposits with Bob as referrer', async () => {
		const term = 500
		const amount = this.dave_liquid
		console.log(`paying ${amount/1e9} FRD`)

		const { unit, error } = await this.dave.sendMulti({
			outputs_by_asset: {
				[this.asset]: [{ address: this.friend_aa, amount: amount }],
				base: [{ address: this.friend_aa, amount: 10_000 }],
			},
			messages: [{
				app: 'data',
				payload: {
					deposit: 1,
					term,
					ref: this.bobAddress,
				}
			}],
			spend_unconfirmed: 'all',
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.dave, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(response.response.responseVars.message).to.eq("Deposited")
		const unlock_date = new Date((response.timestamp + term * 24 * 3600) * 1000).toISOString().substring(0, 10)
		expect(response.response.responseVars.unlock_date).to.eq(unlock_date)

		this.total_locked += amount
		this.dave_profile = {
			balances: {
				frd: amount,
				base: 0,
			},
			unlock_date,
			reg_ts: response.timestamp,
			current_ghost_num: 1,
			ref: this.bobAddress,
		}
		this.ts = response.timestamp

		const { vars } = await this.dave.readAAStateVars(this.friend_aa)
		expect(vars['user_' + this.daveAddress]).to.deep.eq(this.dave_profile)
		expect(vars.total_locked).to.eq(this.total_locked)
		expect(vars.total_locked_bytes).to.eq(this.total_locked_bytes)

		const ref_deposit_reward = Math.floor(amount * 0.01)
		this.bob_liquid += ref_deposit_reward

		const { unitObj } = await this.dave.getUnitInfo({ unit: response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.asset,
				address: this.bobAddress,
				amount: ref_deposit_reward,
			},
		])
	})


	it('Eve deposits without a referrer', async () => {
		const term = 500
		const amount = this.eve_liquid
		console.log(`paying ${amount/1e9} FRD`)

		const { unit, error } = await this.eve.sendMulti({
			outputs_by_asset: {
				[this.asset]: [{ address: this.friend_aa, amount: amount }],
				base: [{ address: this.friend_aa, amount: 10_000 }],
			},
			messages: [{
				app: 'data',
				payload: {
					deposit: 1,
					term,
				}
			}],
			spend_unconfirmed: 'all',
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.eve, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null
		expect(response.response.responseVars.message).to.eq("Deposited")
		const unlock_date = new Date((response.timestamp + term * 24 * 3600) * 1000).toISOString().substring(0, 10)
		expect(response.response.responseVars.unlock_date).to.eq(unlock_date)

		this.total_locked += amount
		this.eve_profile = {
			balances: {
				frd: amount,
				base: 0,
			},
			unlock_date,
			reg_ts: response.timestamp,
			current_ghost_num: 1,
		}
		this.ts = response.timestamp

		const { vars } = await this.eve.readAAStateVars(this.friend_aa)
		expect(vars['user_' + this.eveAddress]).to.deep.eq(this.eve_profile)
		expect(vars.total_locked).to.eq(this.total_locked)
		expect(vars.total_locked_bytes).to.eq(this.total_locked_bytes)
	})


	it('Fred deposits without a referrer', async () => {
		const term = 500
		const amount = this.fred_liquid
		console.log(`paying ${amount/1e9} FRD`)

		const { unit, error } = await this.fred.sendMulti({
			outputs_by_asset: {
				[this.asset]: [{ address: this.friend_aa, amount: amount }],
				base: [{ address: this.friend_aa, amount: 10_000 }],
			},
			messages: [{
				app: 'data',
				payload: {
					deposit: 1,
					term,
				}
			}],
			spend_unconfirmed: 'all',
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.fred, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null
		expect(response.response.responseVars.message).to.eq("Deposited")
		const unlock_date = new Date((response.timestamp + term * 24 * 3600) * 1000).toISOString().substring(0, 10)
		expect(response.response.responseVars.unlock_date).to.eq(unlock_date)

		this.total_locked += amount
		this.fred_profile = {
			balances: {
				frd: amount,
				base: 0,
			},
			unlock_date,
			reg_ts: response.timestamp,
			current_ghost_num: 1,
		}
		this.ts = response.timestamp

		const { vars } = await this.fred.readAAStateVars(this.friend_aa)
		expect(vars['user_' + this.fredAddress]).to.deep.eq(this.fred_profile)
		expect(vars.total_locked).to.eq(this.total_locked)
		expect(vars.total_locked_bytes).to.eq(this.total_locked_bytes)
	})


	it('Carol and Bob become friends', async () => {		
		const isAB = this.carolAddress < this.bobAddress
		const pair = isAB ? this.carolAddress + '_' + this.bobAddress : this.bobAddress + '_' + this.carolAddress
		const ceiling_price = 2 ** ((this.ts - this.launch_ts) / 365 / 24 / 3600)

		const carol_balance = this.carol_profile.balances.base * this.bytes_reducer / ceiling_price + this.carol_profile.balances.frd
		const bob_balance = this.bob_profile.balances.base * this.bytes_reducer / ceiling_price + this.bob_profile.balances.frd
		const new_user_reward = Math.floor(Math.min(10e9, carol_balance, bob_balance))
		const referral_reward = Math.floor(Math.min(10e9, carol_balance))
		const carol_liquid = Math.floor(carol_balance *0.001)
		const carol_locked = Math.floor(carol_balance *0.01) + new_user_reward + referral_reward
		const bob_liquid = Math.floor(bob_balance *0.001)
		const bob_locked = Math.floor(bob_balance *0.01) + new_user_reward
		const carol_rewards = `liquid ${carol_liquid/1e9} FRD, locked ${carol_locked/1e9} FRD, including new user reward ${new_user_reward/1e9} FRD, including referred user reward ${referral_reward/1e9} FRD`
		const bob_rewards = `liquid ${bob_liquid/1e9} FRD, locked ${bob_locked/1e9} FRD, including new user reward ${new_user_reward/1e9} FRD, plus referrer reward ${referral_reward/1e9} FRD`
		const carolRewards = {
			locked: carol_locked,
			liquid: carol_liquid,
			new_user_reward,
			referred_user_reward: referral_reward,
			is_new: true,
		}
		const bobRewards = {
			locked: bob_locked,
			liquid: bob_liquid,
			new_user_reward,
		}
		const rewards = {
			a: isAB ? carolRewards : bobRewards,
			b: isAB ? bobRewards : carolRewards,
			referrers: {
				[this.bobAddress]: referral_reward,
			}
		}

		// carol sends friend request
		const { unit: carol_unit, error: carol_error } = await this.carol.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				connect: 1,
				friend: this.bobAddress,
			},
		})
		expect(carol_error).to.be.null
		expect(carol_unit).to.be.validUnit

		const { response: carol_response } = await this.network.getAaResponseToUnitOnNode(this.carol, carol_unit)
		expect(carol_response.response.error).to.be.undefined
		expect(carol_response.bounced).to.be.false
		expect(carol_response.response_unit).to.be.null
		expect(carol_response.response.responseVars.message).to.eq(`Registered your request. Your friend must send their request within 10 minutes, otherwise you both will have to start over. Expected rewards: ${carol_rewards}.`)

		this.carol_bob_friendship = {
			followup_reward_share: 0.1,
			initial: {
				first: this.carolAddress,
				ts: carol_response.timestamp,
			}
		}

		const { vars: carol_vars } = await this.carol.readAAStateVars(this.friend_aa)
		expect(carol_vars['friendship_' + pair]).to.deep.eq(this.carol_bob_friendship)

		// bob sends friend request
		const { unit: bob_unit, error: bob_error } = await this.bob.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				connect: 1,
				friend: this.carolAddress,
			},
		})
		expect(bob_error).to.be.null
		expect(bob_unit).to.be.validUnit


		const { response: bob_response } = await this.network.getAaResponseToUnitOnNode(this.bob, bob_unit)
		expect(bob_response.response.error).to.be.undefined
		expect(bob_response.bounced).to.be.false
		expect(bob_response.response_unit).to.be.validUnit
		expect(bob_response.response.responseVars.message).to.eq(`Now you've become friends and you've received the following rewards: ${bob_rewards}.`)

		this.carol_bob_friendship.initial.accept_ts = bob_response.timestamp
		this.carol_bob_friendship.initial.rewards = rewards
		delete this.carol_bob_friendship.initial.ts
		delete this.carol_bob_friendship.initial.first

		const { vars: bob_vars } = await this.bob.readAAStateVars(this.friend_aa)
		expect(bob_vars['friendship_' + pair]).to.deep.eq(this.carol_bob_friendship)
		const today = new Date(bob_response.timestamp * 1000).toISOString().substring(0, 10)
		this.carol_profile.balances.frd += carol_locked
	//	this.carol_profile.new_user_rewards = new_user_reward
		this.carol_profile.locked_rewards = carol_locked
		this.carol_profile.liquid_rewards = carol_liquid
		this.carol_profile.last_date = today
		this.carol_profile.total_streak = 1
		this.carol_profile.current_streak = 1
		this.bob_profile.balances.frd += bob_locked + referral_reward
		this.bob_profile.new_user_rewards += new_user_reward
		this.bob_profile.referral_rewards = referral_reward
		this.bob_profile.locked_rewards += bob_locked + referral_reward
		this.bob_profile.liquid_rewards += bob_liquid
		this.bob_profile.last_date = today
	//	this.bob_profile.total_streak = 1
	//	this.bob_profile.current_streak = 1
		this.total_locked += carol_locked + bob_locked + referral_reward
		this.total_new_user_rewards += 2 * new_user_reward
		this.total_referral_rewards = 2 * referral_reward
		this.bob_liquid += bob_liquid
		expect(bob_vars['user_' + this.carolAddress]).to.deep.eq(this.carol_profile)
		expect(bob_vars['user_' + this.bobAddress]).to.deep.eq(this.bob_profile)
		
		expect(bob_vars['friend_' + this.carolAddress + '_' + today]).to.be.eq(this.bobAddress)
		expect(bob_vars['friend_' + this.bobAddress + '_' + today]).to.be.eq(this.carolAddress)
		expect(bob_vars['total_new_user_rewards']).to.be.eq(this.total_new_user_rewards)
		expect(bob_vars['total_referral_rewards']).to.be.eq(this.total_referral_rewards)
		expect(bob_vars['total_locked']).to.eq(this.total_locked)

		const { unitObj } = await this.bob.getUnitInfo({ unit: bob_response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.asset,
				address: this.carolAddress,
				amount: carol_liquid,
			},
			{
				asset: this.asset,
				address: this.bobAddress,
				amount: bob_liquid,
			},
		])

	})


	it('Dave and Bob become friends', async () => {		
		const timestamp = await this.timetravel('1d')
		const isAB = this.daveAddress < this.bobAddress
		const pair = isAB ? this.daveAddress + '_' + this.bobAddress : this.bobAddress + '_' + this.daveAddress
		const ceiling_price = 2 ** ((timestamp - this.launch_ts) / 365 / 24 / 3600)

		const dave_balance = this.dave_profile.balances.base * this.bytes_reducer / ceiling_price + this.dave_profile.balances.frd
		const bob_balance = this.bob_profile.balances.base * this.bytes_reducer / ceiling_price + this.bob_profile.balances.frd
		const new_user_reward = Math.floor(Math.min(10e9, dave_balance, bob_balance))
		const referral_reward = Math.floor(Math.min(10e9, dave_balance))
		const dave_liquid = Math.floor(dave_balance *0.001)
		const dave_locked = Math.floor(dave_balance *0.01) + new_user_reward + referral_reward
		const bob_liquid = Math.floor(bob_balance *0.001)
		const bob_locked = Math.floor(bob_balance *0.01) + new_user_reward
		const dave_rewards = `liquid ${dave_liquid/1e9} FRD, locked ${dave_locked/1e9} FRD, including new user reward ${new_user_reward/1e9} FRD, including referred user reward ${referral_reward/1e9} FRD`
		const bob_rewards = `liquid ${bob_liquid/1e9} FRD, locked ${bob_locked/1e9} FRD, including new user reward ${new_user_reward/1e9} FRD, plus referrer reward ${referral_reward/1e9} FRD`
		const daveRewards = {
			locked: dave_locked,
			liquid: dave_liquid,
			new_user_reward,
			referred_user_reward: referral_reward,
			is_new: true,
		}
		const bobRewards = {
			locked: bob_locked,
			liquid: bob_liquid,
			new_user_reward,
		}
		const rewards = {
			a: isAB ? daveRewards : bobRewards,
			b: isAB ? bobRewards : daveRewards,
			referrers: {
				[this.bobAddress]: referral_reward,
			}
		}

		// dave sends friend request
		const { unit: dave_unit, error: dave_error } = await this.dave.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				connect: 1,
				friend: this.bobAddress,
			},
		})
		expect(dave_error).to.be.null
		expect(dave_unit).to.be.validUnit

		const { response: dave_response } = await this.network.getAaResponseToUnitOnNode(this.dave, dave_unit)
		expect(dave_response.response.error).to.be.undefined
		expect(dave_response.bounced).to.be.false
		expect(dave_response.response_unit).to.be.null
		expect(dave_response.response.responseVars.message).to.eq(`Registered your request. Your friend must send their request within 10 minutes, otherwise you both will have to start over. Expected rewards: ${dave_rewards}.`)

		this.dave_bob_friendship = {
			followup_reward_share: 0.1,
			initial: {
				first: this.daveAddress,
				ts: dave_response.timestamp,
			}
		}

		const { vars: dave_vars } = await this.dave.readAAStateVars(this.friend_aa)
		expect(dave_vars['friendship_' + pair]).to.deep.eq(this.dave_bob_friendship)

		// bob sends friend request
		const { unit: bob_unit, error: bob_error } = await this.bob.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				connect: 1,
				friend: this.daveAddress,
			},
		})
		expect(bob_error).to.be.null
		expect(bob_unit).to.be.validUnit


		const { response: bob_response } = await this.network.getAaResponseToUnitOnNode(this.bob, bob_unit)
		expect(bob_response.response.error).to.be.undefined
		expect(bob_response.bounced).to.be.false
		expect(bob_response.response_unit).to.be.validUnit
		expect(bob_response.response.responseVars.message).to.eq(`Now you've become friends and you've received the following rewards: ${bob_rewards}.`)

		this.dave_bob_friendship.initial.accept_ts = bob_response.timestamp
		this.dave_bob_friendship.initial.rewards = rewards
		delete this.dave_bob_friendship.initial.ts
		delete this.dave_bob_friendship.initial.first

		const { vars: bob_vars } = await this.bob.readAAStateVars(this.friend_aa)
		expect(bob_vars['friendship_' + pair]).to.deep.eq(this.dave_bob_friendship)
		const today = new Date(bob_response.timestamp * 1000).toISOString().substring(0, 10)
		this.dave_profile.balances.frd += dave_locked
	//	this.dave_profile.new_user_rewards = new_user_reward
		this.dave_profile.locked_rewards = dave_locked
		this.dave_profile.liquid_rewards = dave_liquid
		this.dave_profile.last_date = today
		this.dave_profile.total_streak = 1
		this.dave_profile.current_streak = 1
		this.bob_profile.balances.frd += bob_locked + referral_reward
		this.bob_profile.new_user_rewards += new_user_reward
		this.bob_profile.referral_rewards += referral_reward
		this.bob_profile.locked_rewards += bob_locked + referral_reward
		this.bob_profile.liquid_rewards += bob_liquid
		this.bob_profile.last_date = today
		this.bob_profile.total_streak = 2
		this.bob_profile.current_streak = 2
		this.total_locked += dave_locked + bob_locked + referral_reward
		this.total_new_user_rewards += 2 * new_user_reward
		this.total_referral_rewards += 2 * referral_reward
		this.bob_liquid += bob_liquid
		expect(bob_vars['user_' + this.daveAddress]).to.deep.eq(this.dave_profile)
		expect(bob_vars['user_' + this.bobAddress]).to.deep.eq(this.bob_profile)
		
		expect(bob_vars['friend_' + this.daveAddress + '_' + today]).to.be.eq(this.bobAddress)
		expect(bob_vars['friend_' + this.bobAddress + '_' + today]).to.be.eq(this.daveAddress)
		expect(bob_vars['total_new_user_rewards']).to.be.eq(this.total_new_user_rewards)
		expect(bob_vars['total_referral_rewards']).to.be.eq(this.total_referral_rewards)
		expect(bob_vars['total_locked']).to.eq(this.total_locked)

		const { unitObj } = await this.bob.getUnitInfo({ unit: bob_response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.asset,
				address: this.daveAddress,
				amount: dave_liquid,
			},
			{
				asset: this.asset,
				address: this.bobAddress,
				amount: bob_liquid,
			},
		])
	})


	it('Eve and Bob become friends', async () => {		
		const timestamp = await this.timetravel('1d')
		const isAB = this.eveAddress < this.bobAddress
		const pair = isAB ? this.eveAddress + '_' + this.bobAddress : this.bobAddress + '_' + this.eveAddress
		const ceiling_price = 2 ** ((timestamp - this.launch_ts) / 365 / 24 / 3600)

		const eve_balance = this.eve_profile.balances.base * this.bytes_reducer / ceiling_price + this.eve_profile.balances.frd
		const bob_balance = this.bob_profile.balances.base * this.bytes_reducer / ceiling_price + this.bob_profile.balances.frd
		const new_user_reward = Math.floor(Math.min(10e9, eve_balance, bob_balance))
		const referral_reward = 0
		const eve_liquid = Math.floor(eve_balance *0.001)
		const eve_locked = Math.floor(eve_balance *0.01) + new_user_reward + referral_reward
		const bob_liquid = Math.floor(bob_balance *0.001)
		const bob_locked = Math.floor(bob_balance *0.01) + new_user_reward
		const eve_rewards = `liquid ${eve_liquid/1e9} FRD, locked ${eve_locked/1e9} FRD, including new user reward ${new_user_reward/1e9} FRD`
		const bob_rewards = `liquid ${bob_liquid/1e9} FRD, locked ${bob_locked/1e9} FRD, including new user reward ${new_user_reward/1e9} FRD`
		const eveRewards = {
			locked: eve_locked,
			liquid: eve_liquid,
			new_user_reward,
			is_new: true,
		}
		const bobRewards = {
			locked: bob_locked,
			liquid: bob_liquid,
			new_user_reward,
		}
		const rewards = {
			a: isAB ? eveRewards : bobRewards,
			b: isAB ? bobRewards : eveRewards,
		}

		// eve sends friend request
		const { unit: eve_unit, error: eve_error } = await this.eve.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				connect: 1,
				friend: this.bobAddress,
			},
		})
		expect(eve_error).to.be.null
		expect(eve_unit).to.be.validUnit

		const { response: eve_response } = await this.network.getAaResponseToUnitOnNode(this.eve, eve_unit)
		expect(eve_response.response.error).to.be.undefined
		expect(eve_response.bounced).to.be.false
		expect(eve_response.response_unit).to.be.null
		expect(eve_response.response.responseVars.message).to.eq(`Registered your request. Your friend must send their request within 10 minutes, otherwise you both will have to start over. Expected rewards: ${eve_rewards}.`)

		this.eve_bob_friendship = {
			followup_reward_share: 0.1,
			initial: {
				first: this.eveAddress,
				ts: eve_response.timestamp,
			}
		}

		const { vars: eve_vars } = await this.eve.readAAStateVars(this.friend_aa)
		expect(eve_vars['friendship_' + pair]).to.deep.eq(this.eve_bob_friendship)

		// bob sends friend request
		const { unit: bob_unit, error: bob_error } = await this.bob.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				connect: 1,
				friend: this.eveAddress,
			},
		})
		expect(bob_error).to.be.null
		expect(bob_unit).to.be.validUnit


		const { response: bob_response } = await this.network.getAaResponseToUnitOnNode(this.bob, bob_unit)
		expect(bob_response.response.error).to.be.undefined
		expect(bob_response.bounced).to.be.false
		expect(bob_response.response_unit).to.be.validUnit
		expect(bob_response.response.responseVars.message).to.eq(`Now you've become friends and you've received the following rewards: ${bob_rewards}.`)

		this.eve_bob_friendship.initial.accept_ts = bob_response.timestamp
		this.eve_bob_friendship.initial.rewards = rewards
		delete this.eve_bob_friendship.initial.ts
		delete this.eve_bob_friendship.initial.first

		const { vars: bob_vars } = await this.bob.readAAStateVars(this.friend_aa)
		expect(bob_vars['friendship_' + pair]).to.deep.eq(this.eve_bob_friendship)
		const today = new Date(bob_response.timestamp * 1000).toISOString().substring(0, 10)
		this.eve_profile.balances.frd += eve_locked
	//	this.eve_profile.new_user_rewards = new_user_reward
		this.eve_profile.locked_rewards = eve_locked
		this.eve_profile.liquid_rewards = eve_liquid
		this.eve_profile.last_date = today
		this.eve_profile.total_streak = 1
		this.eve_profile.current_streak = 1
		this.bob_profile.balances.frd += bob_locked + referral_reward
		this.bob_profile.new_user_rewards += new_user_reward
		this.bob_profile.referral_rewards += referral_reward
		this.bob_profile.locked_rewards += bob_locked + referral_reward
		this.bob_profile.liquid_rewards += bob_liquid
		this.bob_profile.last_date = today
		this.bob_profile.total_streak = 3
		this.bob_profile.current_streak = 3
		this.total_locked += eve_locked + bob_locked + referral_reward
		this.total_new_user_rewards += 2 * new_user_reward
		this.total_referral_rewards += 2 * referral_reward
		this.bob_liquid += bob_liquid
		expect(bob_vars['user_' + this.eveAddress]).to.deep.eq(this.eve_profile)
		expect(bob_vars['user_' + this.bobAddress]).to.deep.eq(this.bob_profile)
		
		expect(bob_vars['friend_' + this.eveAddress + '_' + today]).to.be.eq(this.bobAddress)
		expect(bob_vars['friend_' + this.bobAddress + '_' + today]).to.be.eq(this.eveAddress)
		expect(bob_vars['total_new_user_rewards']).to.be.eq(this.total_new_user_rewards)
		expect(bob_vars['total_referral_rewards']).to.be.eq(this.total_referral_rewards)
		expect(bob_vars['total_locked']).to.eq(this.total_locked)

		const { unitObj } = await this.bob.getUnitInfo({ unit: bob_response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.asset,
				address: this.eveAddress,
				amount: eve_liquid,
			},
			{
				asset: this.asset,
				address: this.bobAddress,
				amount: bob_liquid,
			},
		])
	})


	it('Fred and Bob become friends', async () => {		
		const timestamp = await this.timetravel('1d')
		const isAB = this.fredAddress < this.bobAddress
		const pair = isAB ? this.fredAddress + '_' + this.bobAddress : this.bobAddress + '_' + this.fredAddress
		const ceiling_price = 2 ** ((timestamp - this.launch_ts) / 365 / 24 / 3600)

		const fred_balance = this.fred_profile.balances.base * this.bytes_reducer / ceiling_price + this.fred_profile.balances.frd
		const bob_balance = this.bob_profile.balances.base * this.bytes_reducer / ceiling_price + this.bob_profile.balances.frd
		const new_user_reward = Math.floor(Math.min(10e9, fred_balance, bob_balance))
		const referral_reward = 0
		const fred_liquid = Math.floor(fred_balance *0.001)
		const fred_locked = Math.floor(fred_balance *0.01) + new_user_reward + referral_reward
		const bob_liquid = Math.floor(bob_balance *0.001)
		const bob_locked = Math.floor(bob_balance *0.01) + new_user_reward
		const fred_rewards = `liquid ${fred_liquid/1e9} FRD, locked ${fred_locked/1e9} FRD, including new user reward ${new_user_reward/1e9} FRD`
		const bob_rewards = `liquid ${bob_liquid/1e9} FRD, locked ${bob_locked/1e9} FRD, including new user reward ${new_user_reward/1e9} FRD`
		const fredRewards = {
			locked: fred_locked,
			liquid: fred_liquid,
			new_user_reward,
			is_new: true,
		}
		const bobRewards = {
			locked: bob_locked,
			liquid: bob_liquid,
			new_user_reward,
		}
		const rewards = {
			a: isAB ? fredRewards : bobRewards,
			b: isAB ? bobRewards : fredRewards,
		}

		// fred sends friend request
		const { unit: fred_unit, error: fred_error } = await this.fred.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				connect: 1,
				friend: this.bobAddress,
			},
		})
		expect(fred_error).to.be.null
		expect(fred_unit).to.be.validUnit

		const { response: fred_response } = await this.network.getAaResponseToUnitOnNode(this.fred, fred_unit)
		expect(fred_response.response.error).to.be.undefined
		expect(fred_response.bounced).to.be.false
		expect(fred_response.response_unit).to.be.null
		expect(fred_response.response.responseVars.message).to.eq(`Registered your request. Your friend must send their request within 10 minutes, otherwise you both will have to start over. Expected rewards: ${fred_rewards}.`)

		this.fred_bob_friendship = {
			followup_reward_share: 0.1,
			initial: {
				first: this.fredAddress,
				ts: fred_response.timestamp,
			}
		}

		const { vars: fred_vars } = await this.fred.readAAStateVars(this.friend_aa)
		expect(fred_vars['friendship_' + pair]).to.deep.eq(this.fred_bob_friendship)

		// bob sends friend request
		const { unit: bob_unit, error: bob_error } = await this.bob.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				connect: 1,
				friend: this.fredAddress,
			},
		})
		expect(bob_error).to.be.null
		expect(bob_unit).to.be.validUnit


		const { response: bob_response } = await this.network.getAaResponseToUnitOnNode(this.bob, bob_unit)
		expect(bob_response.response.error).to.be.undefined
		expect(bob_response.bounced).to.be.false
		expect(bob_response.response_unit).to.be.validUnit
		expect(bob_response.response.responseVars.message).to.eq(`Now you've become friends and you've received the following rewards: ${bob_rewards}.`)

		this.fred_bob_friendship.initial.accept_ts = bob_response.timestamp
		this.fred_bob_friendship.initial.rewards = rewards
		delete this.fred_bob_friendship.initial.ts
		delete this.fred_bob_friendship.initial.first

		const { vars: bob_vars } = await this.bob.readAAStateVars(this.friend_aa)
		expect(bob_vars['friendship_' + pair]).to.deep.eq(this.fred_bob_friendship)
		const today = new Date(bob_response.timestamp * 1000).toISOString().substring(0, 10)
		this.fred_profile.balances.frd += fred_locked
	//	this.fred_profile.new_user_rewards = new_user_reward
		this.fred_profile.locked_rewards = fred_locked
		this.fred_profile.liquid_rewards = fred_liquid
		this.fred_profile.last_date = today
		this.fred_profile.total_streak = 1
		this.fred_profile.current_streak = 1
		this.bob_profile.balances.frd += bob_locked + referral_reward
		this.bob_profile.new_user_rewards += new_user_reward
		this.bob_profile.referral_rewards += referral_reward
		this.bob_profile.locked_rewards += bob_locked + referral_reward
		this.bob_profile.liquid_rewards += bob_liquid
		this.bob_profile.last_date = today
		this.bob_profile.total_streak = 4
		this.bob_profile.current_streak = 4
		this.total_locked += fred_locked + bob_locked + referral_reward
		this.total_new_user_rewards += 2 * new_user_reward
		this.total_referral_rewards += 2 * referral_reward
		this.bob_liquid += bob_liquid
		expect(bob_vars['user_' + this.fredAddress]).to.deep.eq(this.fred_profile)
		expect(bob_vars['user_' + this.bobAddress]).to.deep.eq(this.bob_profile)
		console.log(bob_vars['user_' + this.bobAddress])
		
		expect(bob_vars['friend_' + this.fredAddress + '_' + today]).to.be.eq(this.bobAddress)
		expect(bob_vars['friend_' + this.bobAddress + '_' + today]).to.be.eq(this.fredAddress)
		expect(bob_vars['total_new_user_rewards']).to.be.eq(this.total_new_user_rewards)
		expect(bob_vars['total_referral_rewards']).to.be.eq(this.total_referral_rewards)
		expect(bob_vars['total_locked']).to.eq(this.total_locked)

		const { unitObj } = await this.bob.getUnitInfo({ unit: bob_response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.asset,
				address: this.fredAddress,
				amount: fred_liquid,
			},
			{
				asset: this.asset,
				address: this.bobAddress,
				amount: bob_liquid,
			},
		])
	})


	it('Satoshi ghost and Bob become friends', async () => {		
		const timestamp = await this.timetravel('1d')
		const pair = this.satoshi_name + '_' + this.bobAddress
		const ceiling_price = 2 ** ((timestamp - this.launch_ts) / 365 / 24 / 3600)

		const satoshi_balance = this.satoshi_profile.balances.frd
		const bob_balance = Math.min(this.bob_profile.balances.base * this.bytes_reducer / ceiling_price + this.bob_profile.balances.frd, 200e9)
		const new_user_reward = 0
		const referral_reward = 0
		const satoshi_liquid = Math.floor(satoshi_balance * 0.001)
		const satoshi_locked = Math.floor(satoshi_balance * 0.01) + new_user_reward + referral_reward
		const bob_liquid = Math.floor(bob_balance * 0.001)
		const bob_locked = Math.floor(bob_balance * 0.01) + new_user_reward
		const bob_rewards = `liquid ${bob_liquid/1e9} FRD, locked ${bob_locked/1e9} FRD`
		const satoshiRewards = {
			locked: satoshi_locked,
			liquid: satoshi_liquid,
		}
		const bobRewards = {
			locked: bob_locked,
			liquid: bob_liquid,
		}
		const rewards = {
			a: satoshiRewards,
			b: bobRewards,
		}

		// bob sends friend request
		const { unit: bob_unit, error: bob_error } = await this.bob.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				connect: 1,
				friend: this.satoshi_name,
			},
		})
		expect(bob_error).to.be.null
		expect(bob_unit).to.be.validUnit


		const { response: bob_response } = await this.network.getAaResponseToUnitOnNode(this.bob, bob_unit)
		expect(bob_response.response.error).to.be.undefined
		expect(bob_response.bounced).to.be.false
		expect(bob_response.response_unit).to.be.validUnit
		expect(bob_response.response.responseVars.message).to.eq(`Now you've become friends and you've received the following rewards: ${bob_rewards}.`)

		this.satoshi_bob_friendship = {
			followup_reward_share: 0.1,
			initial: {
			//	first: this.satoshi_name,
			//	ts: bob_response.timestamp,
				accept_ts: bob_response.timestamp,
				rewards,
			}
		}

		const { vars: bob_vars } = await this.bob.readAAStateVars(this.friend_aa)
		expect(bob_vars['friendship_' + pair]).to.deep.eq(this.satoshi_bob_friendship)
		const today = new Date(bob_response.timestamp * 1000).toISOString().substring(0, 10)
		this.satoshi_profile.balances.frd += satoshi_locked
	//	this.satoshi_profile.new_user_rewards = new_user_reward
		this.satoshi_profile.locked_rewards = satoshi_locked + referral_reward
		this.satoshi_profile.liquid_rewards = satoshi_liquid
		this.satoshi_profile.last_date = today
		this.satoshi_profile.total_streak = 1
		this.satoshi_profile.current_streak = 1
		this.bob_profile.balances.frd += bob_locked + referral_reward
		this.bob_profile.new_user_rewards += new_user_reward
		this.bob_profile.referral_rewards += referral_reward
		this.bob_profile.locked_rewards += bob_locked + referral_reward
		this.bob_profile.liquid_rewards += bob_liquid
		this.bob_profile.last_date = today
		this.bob_profile.total_streak = 5
		this.bob_profile.current_streak = 0
		this.bob_profile.current_ghost_num = 2
		this.total_locked += bob_locked + referral_reward
		this.total_new_user_rewards += 2 * new_user_reward
		this.total_referral_rewards += 2 * referral_reward
		this.bob_liquid += bob_liquid
		expect(bob_vars['user_' + this.satoshi_name]).to.deep.eq(this.satoshi_profile)
		expect(bob_vars['user_' + this.bobAddress]).to.deep.eq(this.bob_profile)
		
		expect(bob_vars['friend_' + this.satoshi_name + '_' + today]).to.be.eq(this.bobAddress)
		expect(bob_vars['friend_' + this.bobAddress + '_' + today]).to.be.eq(this.satoshi_name)
		expect(bob_vars['total_new_user_rewards']).to.be.eq(this.total_new_user_rewards)
		expect(bob_vars['total_referral_rewards']).to.be.eq(this.total_referral_rewards)
		expect(bob_vars['total_locked']).to.eq(this.total_locked)

		const { unitObj } = await this.bob.getUnitInfo({ unit: bob_response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.asset,
				address: this.bobAddress,
				amount: bob_liquid,
			},
		])
	})


	it('Carol replaces some FRD with Bytes', async () => {
		const timestamp = await this.timetravel('1d')
		const ceiling_price = 2 ** ((timestamp - this.launch_ts) / 365 / 24 / 3600)
		const bytes_amount = 1e6
		const out_amount = Math.floor(bytes_amount / ceiling_price)

		const { unit, error } = await this.carol.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000 + bytes_amount,
			data: {
				replace: 1,
			},
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.carol, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		this.carol_profile.balances.frd -= out_amount
		this.carol_profile.balances.base += bytes_amount
		this.total_locked -= out_amount
		this.total_locked_bytes += bytes_amount
		
		const { vars } = await this.carol.readAAStateVars(this.friend_aa)
		expect(vars['user_' + this.carolAddress]).to.deep.eq(this.carol_profile)
		expect(vars['total_locked']).to.eq(this.total_locked)
		expect(vars['total_locked_bytes']).to.eq(this.total_locked_bytes)

		const { unitObj } = await this.carol.getUnitInfo({ unit: response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.asset,
				address: this.carolAddress,
				amount: out_amount,
			},
		])
	})


	it("Carol votes for changing the followup reward share", async () => {
		const timestamp = await this.timetravel('0d')
		const ceiling_price = 2 ** ((timestamp - this.launch_ts) / 365 / 24 / 3600)
		const balance = this.carol_profile.balances.base / ceiling_price + this.carol_profile.balances.frd
		const sqrt_balance = +Math.sqrt(balance).toPrecision(15)

		const name = 'followup_reward_share'
		const value = 0.3
		const { unit, error } = await this.carol.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 10000,
			data: {
				name,
				value,
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.carol, unit)
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null

		const { vars: friend_vars } = await this.carol.readAAStateVars(this.friend_aa)
		expect(friend_vars['variables']).to.deep.eq(this.variables)

		this.carolVotes = {
			followup_reward_share: {
				value,
				sqrt_balance,
			},
		}
		const { vars } = await this.carol.readAAStateVars(this.governance_aa)
		expect(vars['support_' + name + '_' + value]).to.be.closeTo(sqrt_balance, 0.00001)
		expect(vars['leader_' + name]).to.eq(value)
		expect(vars['challenging_period_start_ts_' + name]).to.eq(response.timestamp)
		expect(vars['choice_' + this.carolAddress + '_' + name]).to.eq(value)
		expect(vars['votes_' + this.carolAddress]).deepCloseTo(this.carolVotes, 0.00001)

	})


	it("Alice commits the new followup reward share", async () => {
		await this.timetravel('4d')
		const name = 'followup_reward_share'
		const value = 0.3
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 10000,
			data: {
				name,
				commit: 1,
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.alice.readAAStateVars(this.governance_aa)
		expect(vars[name]).to.eq(value)

		this.variables.followup_reward_share = value
		const { vars: friend_vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(friend_vars.variables).to.deep.eq(this.variables)

	})


	it("Carol votes for changing the rewards AA", async () => {
		const timestamp = await this.timetravel('0d')
		const ceiling_price = 2 ** ((timestamp - this.launch_ts) / 365 / 24 / 3600)
		const balance = this.carol_profile.balances.base / ceiling_price + this.carol_profile.balances.frd
		const sqrt_balance = +Math.sqrt(balance).toPrecision(15)

		const name = 'rewards_aa'
		const value = this.rewards2_aa_address
		const { unit, error } = await this.carol.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 10000,
			data: {
				name,
				value,
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.carol, unit)
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null

		const { vars: friend_vars } = await this.carol.readAAStateVars(this.friend_aa)
		expect(friend_vars['variables']).to.deep.eq(this.variables)

		this.carolVotes.rewards_aa = {
			value,
			sqrt_balance,
		}
	//	console.log('carol votes', this.carolVotes)
		expect(this.carolVotes.rewards_aa.sqrt_balance).to.be.lt(this.carolVotes.followup_reward_share.sqrt_balance) // because the ceiling price has grown in 4 days and the locked Bytes became less valuable in terms of FRD

		const { vars } = await this.carol.readAAStateVars(this.governance_aa)
		expect(vars['support_' + name + '_' + value]).to.eq(sqrt_balance)
		expect(vars['leader_' + name]).to.eq(value)
		expect(vars['challenging_period_start_ts_' + name]).to.eq(response.timestamp)
		expect(vars['choice_' + this.carolAddress + '_' + name]).to.eq(value)
		expect(vars['votes_' + this.carolAddress]).deepCloseTo(this.carolVotes, 0.00001)

	})


	it("Alice commits the new rewards AA", async () => {
		await this.timetravel('4d')
		const name = 'rewards_aa'
		const value = this.rewards2_aa_address
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 10000,
			data: {
				name,
				commit: 1,
			},
		})
		console.log({error, unit})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.alice.readAAStateVars(this.governance_aa)
		expect(vars[name]).to.eq(value)

		this.variables.rewards_aa = value
		const { vars: friend_vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(friend_vars.variables).to.deep.eq(this.variables)

	})


	it('Carol and Alice become friends', async () => {
		const timestamp = await this.timetravel('1d')
		const isAB = this.carolAddress < this.aliceAddress
		const pair = isAB ? this.carolAddress + '_' + this.aliceAddress : this.aliceAddress + '_' + this.carolAddress
		const ceiling_price = 2 ** ((timestamp - this.launch_ts) / 365 / 24 / 3600)

		const byte_exchange_rate_in_usdc = Math.max(this.recent.current.pmax, this.recent.prev.pmax)
		const usdc_exchange_rate_in_bytes = 1 / byte_exchange_rate_in_usdc

		const carol_balance = this.carol_profile.balances.base * this.bytes_reducer / ceiling_price + this.carol_profile.balances.frd
		const alice_balance = (this.alice_profile.balances.base * this.bytes_reducer + this.alice_profile.balances[this.usdc] * usdc_exchange_rate_in_bytes * this.deposit_asset_reducer) / ceiling_price + this.alice_profile.balances.frd
		const carol_liquid = Math.floor(carol_balance * 0.002)
		const carol_locked = Math.floor(carol_balance * 0.02)
		const alice_liquid = Math.floor(alice_balance * 0.002)
		const alice_locked = Math.floor(alice_balance * 0.02)
		const carol_rewards = `liquid ${carol_liquid/1e9} FRD, locked ${carol_locked/1e9} FRD`
		const alice_rewards = `liquid ${alice_liquid/1e9} FRD, locked ${alice_locked/1e9} FRD`
		const carolRewards = {
			locked: carol_locked,
			liquid: carol_liquid,
		}
		const aliceRewards = {
			locked: alice_locked,
			liquid: alice_liquid,
		}
		const rewards = {
			a: isAB ? carolRewards : aliceRewards,
			b: isAB ? aliceRewards : carolRewards,
		}

		// carol sends friend request
		const { unit: carol_unit, error: carol_error } = await this.carol.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				connect: 1,
				friend: this.aliceAddress,
			},
		})
		expect(carol_error).to.be.null
		expect(carol_unit).to.be.validUnit

		const { response: carol_response } = await this.network.getAaResponseToUnitOnNode(this.carol, carol_unit)
		if (carol_response.response.error) console.log(carol_response.response.error)
		expect(carol_response.response.error).to.be.undefined
		expect(carol_response.bounced).to.be.false
		expect(carol_response.response_unit).to.be.null
		expect(carol_response.response.responseVars.message).to.eq(`Registered your request. Your friend must send their request within 10 minutes, otherwise you both will have to start over. Expected rewards: ${carol_rewards}.`)

		this.carol_alice_friendship = {
			followup_reward_share: 0.3, // new value
			initial: {
				first: this.carolAddress,
				ts: carol_response.timestamp,
			}
		}
		const { vars: carol_vars } = await this.carol.readAAStateVars(this.friend_aa)
		expect(carol_vars['friendship_' + pair]).to.deep.eq(this.carol_alice_friendship)

		// alice sends friend request
		const { unit: alice_unit, error: alice_error } = await this.alice.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				connect: 1,
				friend: this.carolAddress,
			},
		})
		expect(alice_error).to.be.null
		expect(alice_unit).to.be.validUnit


		const { response: alice_response } = await this.network.getAaResponseToUnitOnNode(this.alice, alice_unit)
		expect(alice_response.response.error).to.be.undefined
		expect(alice_response.bounced).to.be.false
		expect(alice_response.response_unit).to.be.validUnit
		expect(alice_response.response.responseVars.message).to.eq(`Now you've become friends and you've received the following rewards: ${alice_rewards}.`)

		this.carol_alice_friendship.initial.accept_ts = alice_response.timestamp;
		this.carol_alice_friendship.initial.rewards = rewards
		delete this.carol_alice_friendship.initial.ts
		delete this.carol_alice_friendship.initial.first

		const { vars: alice_vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(alice_vars['friendship_' + pair]).to.deep.eq(this.carol_alice_friendship)
		const today = new Date(alice_response.timestamp * 1000).toISOString().substring(0, 10)
		this.carol_profile.balances.frd += carol_locked
		this.carol_profile.locked_rewards += carol_locked
		this.carol_profile.liquid_rewards += carol_liquid
		this.carol_profile.last_date = today
		this.alice_profile.balances.frd += alice_locked
		this.alice_profile.locked_rewards += alice_locked
		this.alice_profile.liquid_rewards += alice_liquid
		this.alice_profile.last_date = today
		this.total_locked += carol_locked + alice_locked
		this.alice_liquid += alice_liquid
		expect(alice_vars['user_' + this.carolAddress]).to.deep.eq(this.carol_profile)
		expect(alice_vars['user_' + this.aliceAddress]).to.deep.eq(this.alice_profile)
		expect(alice_vars['user_' + this.bobAddress]).to.deep.eq(this.bob_profile)
		
		expect(alice_vars['friend_' + this.carolAddress + '_' + today]).to.be.eq(this.aliceAddress)
		expect(alice_vars['friend_' + this.aliceAddress + '_' + today]).to.be.eq(this.carolAddress)
		expect(alice_vars['total_new_user_rewards']).to.be.eq(this.total_new_user_rewards)
		expect(alice_vars['total_referral_rewards']).to.be.eq(this.total_referral_rewards)
		expect(alice_vars['total_locked']).to.eq(this.total_locked)

		const { unitObj } = await this.alice.getUnitInfo({ unit: alice_response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.asset,
				address: this.carolAddress,
				amount: carol_liquid,
			},
			{
				asset: this.asset,
				address: this.aliceAddress,
				amount: alice_liquid,
			},
		])

	})


	it('Carol and Bob claim followup reward', async () => {
		const timestamp = await this.timetravel('55d')
		const isAB = this.carolAddress < this.bobAddress
		const pair = isAB ? this.carolAddress + '_' + this.bobAddress : this.bobAddress + '_' + this.carolAddress
		const ceiling_price = 2 ** ((timestamp - this.launch_ts) / 365 / 24 / 3600)

		const carol_balance = this.carol_profile.balances.base * this.bytes_reducer / ceiling_price + this.carol_profile.balances.frd
		const bob_balance = Math.min(this.bob_profile.balances.base * this.bytes_reducer / ceiling_price + this.bob_profile.balances.frd, 200e9)
		const carol_liquid = Math.floor(carol_balance * 0.002 * 0.1)
		const carol_locked = Math.floor(carol_balance * 0.02 * 0.1)
		const bob_liquid = Math.floor(bob_balance * 0.002 * 0.1)
		const bob_locked = Math.floor(bob_balance * 0.02 * 0.1)
		const carol_rewards = `liquid ${carol_liquid/1e9} FRD, locked ${carol_locked/1e9} FRD`
		const bob_rewards = `liquid ${bob_liquid/1e9} FRD, locked ${bob_locked/1e9} FRD`
		const carolRewards = {
			locked: carol_locked,
			liquid: carol_liquid,
		}
		const bobRewards = {
			locked: bob_locked,
			liquid: bob_liquid,
		}
		const rewards = {
			a: isAB ? carolRewards : bobRewards,
			b: isAB ? bobRewards : carolRewards,
		}

		// carol sends followup request
		const { unit: carol_unit, error: carol_error } = await this.carol.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				followup: 1,
				days: 60,
				friend: this.bobAddress,
			},
		})
		expect(carol_error).to.be.null
		expect(carol_unit).to.be.validUnit

		const { response: carol_response } = await this.network.getAaResponseToUnitOnNode(this.carol, carol_unit)
		expect(carol_response.response.error).to.be.undefined
		expect(carol_response.bounced).to.be.false
		expect(carol_response.response_unit).to.be.null
		expect(carol_response.response.responseVars.message).to.eq(`Registered your request. Your friend must send their request within 10 minutes, otherwise you both will have to start over. Expected rewards: ${carol_rewards}.`)

		this.carol_bob_friendship.followup_60 = {
			first: this.carolAddress,
			ts: carol_response.timestamp,
		}
		const { vars: carol_vars } = await this.carol.readAAStateVars(this.friend_aa)
		expect(carol_vars['friendship_' + pair]).to.deep.eq(this.carol_bob_friendship)

		// bob sends followup request
		const { unit: bob_unit, error: bob_error } = await this.bob.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				followup: 1,
				days: 60,
				friend: this.carolAddress,
			},
		})
		expect(bob_error).to.be.null
		expect(bob_unit).to.be.validUnit


		const { response: bob_response } = await this.network.getAaResponseToUnitOnNode(this.bob, bob_unit)
		expect(bob_response.response.error).to.be.undefined
		expect(bob_response.bounced).to.be.false
		expect(bob_response.response_unit).to.be.validUnit
		expect(bob_response.response.responseVars.message).to.eq(`You've received followup rewards: ${bob_rewards}.`)

		this.carol_bob_friendship.followup_60.accept_ts = bob_response.timestamp
		this.carol_bob_friendship.followup_60.rewards = rewards
		delete this.carol_bob_friendship.followup_60.ts
		delete this.carol_bob_friendship.followup_60.first

		const { vars: bob_vars } = await this.bob.readAAStateVars(this.friend_aa)
		expect(bob_vars['friendship_' + pair]).to.deep.eq(this.carol_bob_friendship)
		const today = new Date(bob_response.timestamp * 1000).toISOString().substring(0, 10)
		this.carol_profile.balances.frd += carol_locked
		this.carol_profile.locked_rewards += carol_locked
		this.carol_profile.liquid_rewards += carol_liquid
		this.bob_profile.balances.frd += bob_locked
		this.bob_profile.locked_rewards += bob_locked
		this.bob_profile.liquid_rewards += bob_liquid
		this.total_locked += carol_locked + bob_locked
		this.bob_liquid += bob_liquid
		expect(bob_vars['user_' + this.carolAddress]).to.deep.eq(this.carol_profile)
		expect(bob_vars['user_' + this.bobAddress]).to.deep.eq(this.bob_profile)
		
		expect(bob_vars['friend_' + this.carolAddress + '_' + today]).to.be.undefined
		expect(bob_vars['friend_' + this.bobAddress + '_' + today]).to.be.undefined
		expect(bob_vars['total_new_user_rewards']).to.be.eq(this.total_new_user_rewards)
		expect(bob_vars['total_referral_rewards']).to.be.eq(this.total_referral_rewards)
		expect(bob_vars['total_locked']).to.eq(this.total_locked)

		const { unitObj } = await this.bob.getUnitInfo({ unit: bob_response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.asset,
				address: this.carolAddress,
				amount: carol_liquid,
			},
			{
				asset: this.asset,
				address: this.bobAddress,
				amount: bob_liquid,
			},
		])

	})


	it('Carol and Bob try to claim the followup reward again', async () => {
		await this.timetravel('1d')

		// carol sends followup request
		const { unit: carol_unit, error: carol_error } = await this.carol.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				followup: 1,
				days: 60,
				friend: this.bobAddress,
			},
		})
		expect(carol_error).to.be.null
		expect(carol_unit).to.be.validUnit

		const { response: carol_response } = await this.network.getAaResponseToUnitOnNode(this.carol, carol_unit)
		expect(carol_response.response.error).to.be.eq("already paid")
		expect(carol_response.bounced).to.be.true
		expect(carol_response.response_unit).to.be.null
	})



	it('Alice replaces some Bytes with FRD', async () => {
		const timestamp = await this.timetravel('10d')
		const ceiling_price = 2 ** ((timestamp - this.launch_ts) / 365 / 24 / 3600)
		const amount = 1e6
		const out_bytes_amount = Math.floor(amount * ceiling_price)

		const { unit, error } = await this.alice.sendMulti({
			outputs_by_asset: {
				[this.asset]: [{ address: this.friend_aa, amount: amount }],
				base: [{ address: this.friend_aa, amount: 10_000 }],
			},
			messages: [{
				app: 'data',
				payload: {
					replace: 1,
				}
			}],
			spend_unconfirmed: 'all',
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		this.alice_profile.balances.frd += amount
		this.alice_profile.balances.base -= out_bytes_amount
		this.total_locked += amount
		this.total_locked_bytes -= out_bytes_amount

		const { vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(vars['user_' + this.aliceAddress]).to.deep.eq(this.alice_profile)
		expect(vars['total_locked']).to.eq(this.total_locked)
		expect(vars['total_locked_bytes']).to.eq(this.total_locked_bytes)

		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				address: this.aliceAddress,
				amount: out_bytes_amount,
			},
		])
	})


	it('Alice replaces some USDC with FRD', async () => {
		const timestamp = await this.timetravel('10d')
		const ceiling_price = 2 ** ((timestamp - this.launch_ts) / 365 / 24 / 3600)
		const amount = 10e6 // in FRD

		const byte_exchange_rate_in_usdc = Math.min(this.recent.current.pmin, this.recent.prev.pmin) / 1.1

		const out_usdc_amount = Math.floor(amount * ceiling_price * byte_exchange_rate_in_usdc)

		const { unit, error } = await this.alice.sendMulti({
			outputs_by_asset: {
				[this.asset]: [{ address: this.friend_aa, amount: amount }],
				base: [{ address: this.friend_aa, amount: 10_000 }],
			},
			messages: [{
				app: 'data',
				payload: {
					replace: 1,
					deposit_asset: this.usdc,
				}
			}],
			spend_unconfirmed: 'all',
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		this.alice_profile.balances.frd += amount
		this.alice_profile.balances[this.usdc] -= out_usdc_amount
		this.total_locked += amount

		const { vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(vars['user_' + this.aliceAddress]).to.deep.eq(this.alice_profile)
		expect(vars['total_locked']).to.eq(this.total_locked)
		expect(vars['total_locked_bytes']).to.eq(this.total_locked_bytes)

		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.usdc,
				address: this.aliceAddress,
				amount: out_usdc_amount,
			},
		])
	})


	it('Alice replaces some FRD with USDC', async () => {
		const timestamp = await this.timetravel('10d')
		const ceiling_price = 2 ** ((timestamp - this.launch_ts) / 365 / 24 / 3600)
		const amount = 100e4 // in USDC

		const byte_exchange_rate_in_usdc = Math.max(this.recent.current.pmax, this.recent.prev.pmax)
		const usdc_exchange_rate_in_bytes = 1 / byte_exchange_rate_in_usdc * 0.9

		const out_amount = Math.floor(amount / ceiling_price * usdc_exchange_rate_in_bytes)

		const { unit, error } = await this.alice.sendMulti({
			outputs_by_asset: {
				[this.usdc]: [{ address: this.friend_aa, amount: amount }],
				base: [{ address: this.friend_aa, amount: 10_000 }],
			},
			messages: [{
				app: 'data',
				payload: {
					replace: 1,
					deposit_asset: this.usdc,
				}
			}],
			spend_unconfirmed: 'all',
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		this.alice_profile.balances.frd -= out_amount
		this.alice_profile.balances[this.usdc] += amount
		this.total_locked -= out_amount

		const { vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(vars['user_' + this.aliceAddress]).to.deep.eq(this.alice_profile)
		expect(vars['total_locked']).to.eq(this.total_locked)
		expect(vars['total_locked_bytes']).to.eq(this.total_locked_bytes)

		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.asset,
				address: this.aliceAddress,
				amount: out_amount,
			},
		])
	})


	it('Carol tries to withdraw before unlock', async () => {
		const { unit, error } = await this.carol.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				withdraw: 1,
			},
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.carol, unit)
		expect(response.response.error).to.be.eq(`your balance unlocks on ${this.carol_profile.unlock_date}`)
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.null
	})


	it('Carol withdraws', async () => {
		await this.timetravel('450d')

		const { unit, error } = await this.carol.triggerAaWithData({
			toAddress: this.friend_aa,
			amount: 10000,
			data: {
				withdraw: 1,
			},
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.carol, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { unitObj } = await this.carol.getUnitInfo({ unit: response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.asset,
				address: this.carolAddress,
				amount: this.carol_profile.balances.frd,
			},
			{
				address: this.carolAddress,
				amount: this.carol_profile.balances.base,
			},
			{
				address: this.governance_aa,
				amount: 1000,
			},
		])
		
		this.total_locked -= this.carol_profile.balances.frd
		this.total_locked_bytes -= this.carol_profile.balances.base
		this.carol_profile.balances.frd = 0
		this.carol_profile.balances.base = 0
		
		const { vars } = await this.carol.readAAStateVars(this.friend_aa)
		expect(vars['user_' + this.carolAddress]).to.deep.eq(this.carol_profile)
		expect(vars['total_locked']).to.eq(this.total_locked)
		expect(vars['total_locked_bytes']).to.eq(this.total_locked_bytes)

		this.carolVotes.followup_reward_share.sqrt_balance = 0
		this.carolVotes.rewards_aa.sqrt_balance = 0
		const { vars: governance_vars } = await this.carol.readAAStateVars(this.governance_aa)
		const checkVar = (name, value) => {
			expect(governance_vars['support_' + name + '_' + value]).to.eq(0)
			expect(governance_vars['leader_' + name]).to.eq(value)
			expect(governance_vars['choice_' + this.carolAddress + '_' + name]).to.eq(value)
		}
		checkVar('followup_reward_share', 0.3)
		checkVar('rewards_aa', this.rewards2_aa_address)
		expect(governance_vars['votes_' + this.carolAddress]).deep.eq(this.carolVotes)
	})


	after(async () => {
		await this.network.stop()
	})
})
