import {ethers} from "hardhat";
import {Misc} from "../../Misc";
import {BigNumber} from "ethers";
import {parseUnits} from 'ethers/lib/utils';

const minterAddr = "0x3059d7762bc85a94949310e4fC4fAfe5638b9dbb";

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
  const p = await ethers.provider
  console.log('Network:', await p.getNetwork())
  console.log('BlockNumber:', await p.getBlockNumber())

  const signer = (await ethers.getSigners())[0];

  let minterMax = BigNumber.from("0");

  for (const c of claimantsAmounts) {
    minterMax = minterMax.add(c);
  }

  const minter = await ethers.getContractAt('contracts/base/token/RemoteMinter.sol:RemoteMinter', minterAddr, signer);
  await Misc.runAndWait(() => minter.initialize(
      claimants,
      claimantsAmounts,
      minterMax,
      0
  ), false);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
