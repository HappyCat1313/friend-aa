
const locked_reward = 0.005;
const liquid_reward = 0.005 * 0.19;

let locked_balance = 1;
let liquid_income = 0;

function run(days) {
	for (let day = 1; day <= days; day++) {
		liquid_income += locked_balance * liquid_reward;
		locked_balance *= 1 + locked_reward;
	}
	console.log({locked_balance, liquid_income})
}

console.log({ locked_reward, liquid_reward });
run(365);
run(365);
run(365);
