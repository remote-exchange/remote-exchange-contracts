import {Deploy} from "../Deploy";
import {ethers} from "hardhat";
import {Verify} from "../../Verify";
import {Misc} from "../../Misc";
import {BigNumber} from "ethers";
import {GoerliAddresses} from "../../addresses/GoerliAddresses";
import {writeFileSync} from "fs";
import {parseUnits} from 'ethers/lib/utils';


const voterTokens = [
  GoerliAddresses.WNATIVE_TOKEN,
  GoerliAddresses.USDC_TOKEN,
  GoerliAddresses.DAI_TOKEN,
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
  parseUnits('100'),
  parseUnits('100'),
  parseUnits('100'),
  parseUnits('100'),
  parseUnits('100'),
];

async function main() {
  const p = await ethers.provider
  console.log('Network:', await p.getNetwork())
  console.log('BlockNumber:', await p.getBlockNumber())

  const signer = (await ethers.getSigners())[0];

  let minterMax = BigNumber.from("0");

  for (const c of claimantsAmounts) {
    minterMax = minterMax.add(c);
  }

  const core = await Deploy.deployCore(signer, GoerliAddresses.WNATIVE_TOKEN, voterTokens, claimants, claimantsAmounts, minterMax, 0)

  const swapLibrary = await Deploy.deployContract(signer, 'SwapLibrary', ROUTER);

  const multicall = await Deploy.deployContract(signer, 'Multicall');

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
    + 'swapLibrary: ' + swapLibrary.address + '\n'
    + 'multicall: ' + multicall.address + '\n'

  console.log(data);
  writeFileSync('tmp/addresses_goerli.txt', data);

  await Misc.wait(5);

  await Verify.verify(core.token.address);
  await Verify.verify(core.gaugesFactory.address);
  await Verify.verify(core.bribesFactory.address);
  await Verify.verify(core.factory.address);
  await Verify.verifyWithArgs(core.router.address, [core.factory.address, GoerliAddresses.WNATIVE_TOKEN]);
  await Verify.verifyWithArgs(core.ve.address, [core.token.address]);
  await Verify.verifyWithArgs(core.veDist.address, [core.ve.address]);
  await Verify.verifyWithArgs(core.voter.address, [core.ve.address, core.factory.address, core.gaugesFactory.address, core.bribesFactory.address]);
  await Verify.verifyWithArgs(core.minter.address, [core.ve.address, core.controller.address]);
  await Verify.verifyWithArgs(swapLibrary.address, [core.router.address]);
  await Verify.verify(multicall.address);

}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
