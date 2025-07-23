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

		this.network = await Network.create()
			.with.numberOfWitnesses(1)
			.with.agent({ governance_base: path.join(__dirname, '../governance.oscript') })
			.with.agent({ rewards_aa: path.join(__dirname, '../rewards.oscript') })
			.with.agent({ rewards2_aa: path.join(__dirname, '../rewards2.oscript') })
			.with.wallet({ alice: 1000e9 })
			.with.wallet({ bob: 1000e9 })
			.with.wallet({ carol: 1000e9 })
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
		
		this.messagingAttestor = this.network.wallet.messagingAttestor
		this.messagingAttestorAddress = await this.messagingAttestor.getAddress()
		
		this.realNameAttestor = this.network.wallet.realNameAttestor
		this.realNameAttestorAddress = await this.realNameAttestor.getAddress()

		this.rewards_aa_address = await this.network.agent.rewards_aa
		this.rewards2_aa_address = await this.network.agent.rewards2_aa


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



	})


	it('Deploy Friend AA', async () => {
		let friend = fs.readFileSync(path.join(__dirname, '../friend.oscript'), 'utf8');
		friend = friend.replace(/rewards_aa: '\w*'/, `rewards_aa: '${this.rewards_aa_address}'`)
		friend = friend.replace(/messaging_attestors: '\w*'/, `messaging_attestors: '${this.messagingAttestorAddress}'`)
		friend = friend.replace(/real_name_attestors: '\w*'/, `real_name_attestors: '${this.realNameAttestorAddress}'`)

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
			balance: 0,
			bytes_balance: amount,
			unlock_date,
			reg_ts: response.timestamp,
		}

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


	it('Bob deposits 501 GB without real-name attestation', async () => {
		const amount = 501e9
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
			balance: 0,
			bytes_balance: amount,
			unlock_date,
			reg_ts: response.timestamp,
		}

		const { vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(vars['user_' + this.bobAddress]).to.deep.eq(this.bob_profile)
		expect(vars.total_locked).to.eq(0)
		expect(vars.total_locked_bytes).to.eq(this.total_locked_bytes)
	})


	it('Alice and Bob become friends', async () => {
		const pair = this.aliceAddress < this.bobAddress ? this.aliceAddress + '_' + this.bobAddress : this.bobAddress + '_' + this.aliceAddress

		const alice_balance = this.alice_profile.bytes_balance
		const bob_balance = this.bob_profile.bytes_balance
		const new_user_reward = Math.min(10e9, alice_balance, bob_balance)
		const alice_liquid = Math.floor(alice_balance * 0.001)
		const alice_locked = Math.floor(alice_balance * 0.01) + new_user_reward
		const bob_liquid = Math.floor(bob_balance * 0.001)
		const bob_locked = Math.floor(bob_balance * 0.01) + new_user_reward
		const alice_rewards = `liquid ${alice_liquid/1e9} FRD, locked ${alice_locked/1e9} FRD, including new user reward ${new_user_reward/1e9} FRD`
		const bob_rewards = `liquid ${bob_liquid/1e9} FRD, locked ${bob_locked/1e9} FRD, including new user reward ${new_user_reward/1e9} FRD`

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
				first: this.aliceAddress,
				ts: alice_response.timestamp,
				accept_ts: bob_response.timestamp,
			}
		})
		const today = new Date(bob_response.timestamp * 1000).toISOString().substring(0, 10)
		this.alice_profile.balance = alice_locked
		this.alice_profile.new_user_rewards = new_user_reward
		this.alice_profile.last_date = today
		this.bob_profile.balance = bob_locked
		this.bob_profile.new_user_rewards = new_user_reward
		this.bob_profile.last_date = today
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
		const balance = this.alice_profile.bytes_balance / ceiling_price + this.alice_profile.balance
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

		const { vars: friend_vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(friend_vars['variables']).to.be.undefined

		const { vars } = await this.alice.readAAStateVars(this.governance_aa)
		expect(vars['support_' + name + '_' + value]).to.eq(sqrt_balance)
		expect(vars['leader_' + name]).to.eq(value)
		expect(vars['challenging_period_start_ts_' + name]).to.eq(response.timestamp)
		expect(vars['choice_' + this.aliceAddress + '_' + name]).to.eq(value)
		expect(vars['votes_' + this.aliceAddress]).deep.eq({
			messaging_attestors: {
				value,
				sqrt_balance,
			},
		})

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


	it('Bob sends some FRD to Carol', async () => {
		const amount = Math.floor(this.bob_liquid / 2)
		const { unit, error } = await this.bob.sendMulti({
			to_address: this.carolAddress,
			amount,
			asset: this.asset,
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		this.carol_liquid = amount
		this.bob_liquid -= amount
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
			balance: amount,
			bytes_balance: 0,
			unlock_date,
			reg_ts: response.timestamp,
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


	it('Carol and Bob become friends', async () => {		
		const pair = this.carolAddress < this.bobAddress ? this.carolAddress + '_' + this.bobAddress : this.bobAddress + '_' + this.carolAddress
		const ceiling_price = 2 ** ((this.ts - this.launch_ts) / 365 / 24 / 3600)

		const carol_balance = this.carol_profile.bytes_balance / ceiling_price + this.carol_profile.balance
		const bob_balance = this.bob_profile.bytes_balance / ceiling_price + this.bob_profile.balance
		const new_user_reward = Math.floor(Math.min(10e9, carol_balance, bob_balance))
		const referral_reward = Math.floor(Math.min(10e9, carol_balance))
		const carol_liquid = Math.floor(carol_balance *0.001)
		const carol_locked = Math.floor(carol_balance *0.01) + new_user_reward + referral_reward
		const bob_liquid = Math.floor(bob_balance *0.001)
		const bob_locked = Math.floor(bob_balance *0.01) + new_user_reward
		const carol_rewards = `liquid ${carol_liquid/1e9} FRD, locked ${carol_locked/1e9} FRD, including new user reward ${new_user_reward/1e9} FRD, including referred user reward ${referral_reward/1e9} FRD`
		const bob_rewards = `liquid ${bob_liquid/1e9} FRD, locked ${bob_locked/1e9} FRD, including new user reward ${new_user_reward/1e9} FRD, plus referrer reward ${referral_reward/1e9} FRD`

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

		const { vars: bob_vars } = await this.bob.readAAStateVars(this.friend_aa)
		expect(bob_vars['friendship_' + pair]).to.deep.eq(this.carol_bob_friendship)
		const today = new Date(bob_response.timestamp * 1000).toISOString().substring(0, 10)
		this.carol_profile.balance += carol_locked
	//	this.carol_profile.new_user_rewards = new_user_reward
		this.carol_profile.last_date = today
		this.bob_profile.balance += bob_locked + referral_reward
		this.bob_profile.new_user_rewards += new_user_reward
		this.bob_profile.referral_rewards = referral_reward
		this.bob_profile.last_date = today
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

		this.carol_profile.balance -= out_amount
		this.carol_profile.bytes_balance += bytes_amount
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
		const balance = this.carol_profile.bytes_balance / ceiling_price + this.carol_profile.balance
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
		expect(vars['support_' + name + '_' + value]).to.eq(sqrt_balance)
		expect(vars['leader_' + name]).to.eq(value)
		expect(vars['challenging_period_start_ts_' + name]).to.eq(response.timestamp)
		expect(vars['choice_' + this.carolAddress + '_' + name]).to.eq(value)
		expect(vars['votes_' + this.carolAddress]).deep.eq(this.carolVotes)

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
		const balance = this.carol_profile.bytes_balance / ceiling_price + this.carol_profile.balance
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
		expect(vars['votes_' + this.carolAddress]).deep.eq(this.carolVotes)

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
		const pair = this.carolAddress < this.aliceAddress ? this.carolAddress + '_' + this.aliceAddress : this.aliceAddress + '_' + this.carolAddress
		const ceiling_price = 2 ** ((timestamp - this.launch_ts) / 365 / 24 / 3600)

		const carol_balance = this.carol_profile.bytes_balance / ceiling_price + this.carol_profile.balance
		const alice_balance = this.alice_profile.bytes_balance / ceiling_price + this.alice_profile.balance
		const carol_liquid = Math.floor(carol_balance * 0.002)
		const carol_locked = Math.floor(carol_balance * 0.02)
		const alice_liquid = Math.floor(alice_balance * 0.002)
		const alice_locked = Math.floor(alice_balance * 0.02)
		const carol_rewards = `liquid ${carol_liquid/1e9} FRD, locked ${carol_locked/1e9} FRD`
		const alice_rewards = `liquid ${alice_liquid/1e9} FRD, locked ${alice_locked/1e9} FRD`

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
		const { vars: alice_vars } = await this.alice.readAAStateVars(this.friend_aa)
		expect(alice_vars['friendship_' + pair]).to.deep.eq(this.carol_alice_friendship)
		const today = new Date(alice_response.timestamp * 1000).toISOString().substring(0, 10)
		this.carol_profile.balance += carol_locked
		this.carol_profile.last_date = today
		this.alice_profile.balance += alice_locked
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
		const pair = this.carolAddress < this.bobAddress ? this.carolAddress + '_' + this.bobAddress : this.bobAddress + '_' + this.carolAddress
		const ceiling_price = 2 ** ((timestamp - this.launch_ts) / 365 / 24 / 3600)

		const carol_balance = this.carol_profile.bytes_balance / ceiling_price + this.carol_profile.balance
		const bob_balance = Math.min(this.bob_profile.bytes_balance / ceiling_price + this.bob_profile.balance, 200e9)
		const carol_liquid = Math.floor(carol_balance * 0.002 * 0.1)
		const carol_locked = Math.floor(carol_balance * 0.02 * 0.1)
		const bob_liquid = Math.floor(bob_balance * 0.002 * 0.1)
		const bob_locked = Math.floor(bob_balance * 0.02 * 0.1)
		const carol_rewards = `liquid ${carol_liquid/1e9} FRD, locked ${carol_locked/1e9} FRD`
		const bob_rewards = `liquid ${bob_liquid/1e9} FRD, locked ${bob_locked/1e9} FRD`

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
		const { vars: bob_vars } = await this.bob.readAAStateVars(this.friend_aa)
		expect(bob_vars['friendship_' + pair]).to.deep.eq(this.carol_bob_friendship)
		const today = new Date(bob_response.timestamp * 1000).toISOString().substring(0, 10)
		this.carol_profile.balance += carol_locked
		this.bob_profile.balance += bob_locked
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

		this.alice_profile.balance += amount
		this.alice_profile.bytes_balance -= out_bytes_amount
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
				amount: this.carol_profile.balance,
			},
			{
				address: this.carolAddress,
				amount: this.carol_profile.bytes_balance,
			},
			{
				address: this.governance_aa,
				amount: 1000,
			},
		])
		
		this.total_locked -= this.carol_profile.balance
		this.total_locked_bytes -= this.carol_profile.bytes_balance
		this.carol_profile.balance = 0
		this.carol_profile.bytes_balance = 0
		
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
