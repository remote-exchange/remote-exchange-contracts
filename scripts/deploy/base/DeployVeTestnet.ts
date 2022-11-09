import {Deploy} from "../Deploy";
import {ethers} from "hardhat";
import {Verify} from "../../Verify";
import {Misc} from "../../Misc";
import {BigNumber} from "ethers";
import {writeFileSync} from "fs";
import {parseUnits} from "ethers/lib/utils";
import {NeonDevnetAddresses} from "../../addresses/NeonDevnetAddresses";


const voterTokens = [
  NeonDevnetAddresses.WNATIVE_TOKEN,
  NeonDevnetAddresses.USDC_TOKEN,
  NeonDevnetAddresses.DAI_TOKEN,
  NeonDevnetAddresses.USDT_TOKEN,
];

const claimants = [
  "0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94",
];

const claimantsAmounts = [
  parseUnits('1'),
];

const FACTORY = '0xE452CDC71B9f488333fa9a999B421BaC0cD988fc';
const WARMING = 0;

async function main() {
  const signer = (await ethers.getSigners())[0];

  let minterMax = BigNumber.from("0");

  for (const c of claimantsAmounts) {
    minterMax = minterMax.add(c);
  }

  const [
    controller,
    token,
    gaugesFactory,
    bribesFactory,
    ve,
    veDist,
    voter,
    minter,
  ] = await Deploy.deployRemoteSystem(
    signer,
    voterTokens,
    claimants,
    claimantsAmounts,
    minterMax,
    FACTORY,
    0
  );

  const data = ''
    + 'controller: ' + controller.address + '\n'
    + 'token: ' + token.address + '\n'
    + 'gaugesFactory: ' + gaugesFactory.address + '\n'
    + 'bribesFactory: ' + bribesFactory.address + '\n'
    + 've: ' + ve.address + '\n'
    + 'veDist: ' + veDist.address + '\n'
    + 'voter: ' + voter.address + '\n'
    + 'minter: ' + minter.address + '\n'

  console.log(data);
  writeFileSync('tmp/core_test.txt', data);

  await Misc.wait(50);

  // await Verify.verify(controller.address);
  // await Verify.verify(token.address);
  // await Verify.verify(gaugesFactory.address);
  // await Verify.verify(bribesFactory.address);
  // await Verify.verifyWithArgs(ve.address, [token.address, controller.address]);
  // await Verify.verifyWithArgs(veDist.address, [ve.address]);
  // await Verify.verifyWithArgs(voter.address, [ve.address, FACTORY, gaugesFactory.address, bribesFactory.address]);
  // await Verify.verifyWithArgs(minter.address, [ve.address, controller.address, WARMING]);

}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
