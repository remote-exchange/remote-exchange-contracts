import {Deploy} from "../Deploy";
import {ethers} from "hardhat";
import {Verify} from "../../Verify";
import {Misc} from "../../Misc";
import {BigNumber} from "ethers";
import {NeonDevnetAddresses} from "../../addresses/NeonDevnetAddresses";
import {writeFileSync} from "fs";
import {parseUnits} from 'ethers/lib/utils';


const voterTokens = [
  NeonDevnetAddresses.WNATIVE_TOKEN,
  NeonDevnetAddresses.USDC_TOKEN,
  NeonDevnetAddresses.DAI_TOKEN,
  NeonDevnetAddresses.USDT_TOKEN,
];

const claimants = [
  "0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94",
  "0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94",
  "0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94",
  "0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94",
  "0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94",
  "0xbbbbb8C4364eC2ce52c59D2Ed3E56F307E529a94",
];

const claimantsAmounts = [
  parseUnits('100'),
  parseUnits('200'),
  parseUnits('300'),
  parseUnits('400'),
  parseUnits('500'),
  parseUnits('600'),
];

async function main() {
  const signer = (await ethers.getSigners())[0];

  let minterMax = BigNumber.from("0");

  for (const c of claimantsAmounts) {
    minterMax = minterMax.add(c);
  }

  const core = await Deploy.deployCore(signer, NeonDevnetAddresses.WNATIVE_TOKEN, voterTokens, claimants, claimantsAmounts, minterMax, 0)

  const data = ''
    + 'token: ' + core.token.address + '\n'
    + 'gaugesFactory: ' + core.gaugesFactory.address + '\n'
    + 'bribesFactory: ' + core.bribesFactory.address + '\n'
    + 'factory: ' + core.factory.address + '\n'
    + 'router: ' + core.router.address + '\n'
    + 've: ' + core.ve.address + '\n'
    + 'veDist: ' + core.veDist.address + '\n'
    + 'voter: ' + core.voter.address + '\n'
    + 'minter: ' + core.minter.address + '\n'
    + 'controller: ' + core.controller.address + '\n'

  console.log(data);
  writeFileSync('core_testnet.txt', data);

  await Misc.wait(5);

  // await Verify.verify(core.token.address);
  // await Verify.verify(core.gaugesFactory.address);
  // await Verify.verify(core.bribesFactory.address);
  // await Verify.verify(core.factory.address);
  // await Verify.verifyWithArgs(core.router.address, [core.factory.address, NeonDevnetAddresses.WBNB_TOKEN]);
  // await Verify.verifyWithArgs(core.ve.address, [core.token.address]);
  // await Verify.verifyWithArgs(core.veDist.address, [core.ve.address]);
  // await Verify.verifyWithArgs(core.voter.address, [core.ve.address, core.factory.address, core.gaugesFactory.address, core.bribesFactory.address]);
  // await Verify.verifyWithArgs(core.minter.address, [core.ve.address, core.controller.address]);

}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
