import {ethers, web3} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Logger} from "tslog";
import logSettings from "../../log_settings";
import {BigNumber, ContractFactory, utils} from "ethers";
import {Libraries} from "hardhat-deploy/dist/types";
import {
  BribeFactory,
  Remote,
  RemoteFactory,
  RemoteMinter,
  RemoteRouter01,
  RemoteVoter,
  Controller,
  GaugeFactory,
  Token,
  Ve,
  VeDist
} from "../../typechain";
import {Misc} from "../Misc";
import {CoreAddresses} from "./CoreAddresses";

const log: Logger = new Logger(logSettings);

const libraries = new Map<string, string>([
  ['Ve', 'VeLogo']
]);

export class Deploy {

  // ************ CONTRACT CONNECTION **************************

  public static async deployContract<T extends ContractFactory>(
    signer: SignerWithAddress,
    name: string,
    // tslint:disable-next-line:no-any
    ...args: any[]
  ) {
    log.info(`Deploying ${name}`);
    log.info("Account balance: " + utils.formatUnits(await signer.getBalance(), 18));

    const gasPrice = await web3.eth.getGasPrice();
    log.info("Gas price: " + gasPrice);
    const lib: string | undefined = libraries.get(name);
    let _factory;
    if (lib) {
      log.info('DEPLOY LIBRARY', lib, 'for', name);
      const libAddress = (await Deploy.deployContract(signer, lib)).address;
      const librariesObj: Libraries = {};
      librariesObj[lib] = libAddress;
      _factory = (await ethers.getContractFactory(
        name,
        {
          signer,
          libraries: librariesObj
        }
      )) as T;
    } else {
      _factory = (await ethers.getContractFactory(
        name,
        signer
      )) as T;
    }
    const instance = await _factory.deploy(...args);
    log.info('Deploy tx:', instance.deployTransaction.hash);
    await instance.deployed();

    const receipt = await ethers.provider.getTransactionReceipt(instance.deployTransaction.hash);
    log.info('Receipt', receipt.contractAddress)
    return _factory.attach(receipt.contractAddress);
  }

  public static async deployRemote(signer: SignerWithAddress) {
    return (await Deploy.deployContract(signer, 'Remote')) as Remote;
  }

  public static async deployToken(signer: SignerWithAddress, name: string, symbol: string, decimal: number) {
    return (await Deploy.deployContract(signer, 'Token', name, symbol, decimal, signer.address)) as Token;
  }

  public static async deployGaugeFactory(signer: SignerWithAddress) {
    return (await Deploy.deployContract(signer, 'GaugeFactory')) as GaugeFactory;
  }

  public static async deployBribeFactory(signer: SignerWithAddress) {
    return (await Deploy.deployContract(signer, 'BribeFactory')) as BribeFactory;
  }

  public static async deployRemoteFactory(signer: SignerWithAddress) {
    return (await Deploy.deployContract(signer, 'RemoteFactory')) as RemoteFactory;
  }

  public static async deployRemoteRouter01(
    signer: SignerWithAddress,
    factory: string,
    networkToken: string,
  ) {
    return (await Deploy.deployContract(signer, 'RemoteRouter01', factory, networkToken)) as RemoteRouter01;
  }

  public static async deployVe(signer: SignerWithAddress, token: string, controller: string) {
    return (await Deploy.deployContract(signer, 'Ve', token, controller)) as Ve;
  }

  public static async deployVeDist(signer: SignerWithAddress, ve: string) {
    return (await Deploy.deployContract(signer, 'VeDist', ve)) as VeDist;
  }

  public static async deployRemoteVoter(
    signer: SignerWithAddress,
    ve: string,
    factory: string,
    gauges: string,
    bribes: string,
  ) {
    return (await Deploy.deployContract(
      signer,
      'RemoteVoter',
      ve,
      factory,
      gauges,
      bribes,
    )) as RemoteVoter;
  }

  public static async deployRemoteMinter(
    signer: SignerWithAddress,
    ve: string,
    controller: string,
  ) {
    return (await Deploy.deployContract(
      signer,
      'RemoteMinter',
      ve,
      controller
    )) as RemoteMinter;
  }

  public static async deployCore(
    signer: SignerWithAddress,
    networkToken: string,
    voterTokens: string[],
    minterClaimants: string[],
    minterClaimantsAmounts: BigNumber[],
    minterSum: BigNumber,
    warmingUpPeriod = 2,
    delays: boolean = true
  ) {
    const [baseFactory, router] = await Deploy.deployDex(signer, networkToken);

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
      minterClaimants,
      minterClaimantsAmounts,
      minterSum,
      baseFactory.address,
      warmingUpPeriod,
      delays
    );

    return new CoreAddresses(
      token as Remote,
      gaugesFactory as GaugeFactory,
      bribesFactory as BribeFactory,
      baseFactory as RemoteFactory,
      router as RemoteRouter01,
      ve as Ve,
      veDist as VeDist,
      voter as RemoteVoter,
      minter as RemoteMinter,
      controller as Controller,
    );
  }


  public static async deployDex(
    signer: SignerWithAddress,
    networkToken: string,
  ) {
    const baseFactory = await Deploy.deployRemoteFactory(signer);
    const router = await Deploy.deployRemoteRouter01(signer, baseFactory.address, networkToken);

    return [baseFactory, router];
  }

  public static async deployRemoteSystem(
    signer: SignerWithAddress,
    voterTokens: string[],
    minterClaimants: string[],
    minterClaimantsAmounts: BigNumber[],
    minterSum: BigNumber,
    baseFactory: string,
    warmingUpPeriod: number,
    delays: boolean = true
  ) {
    const controller = await Deploy.deployContract(signer, 'Controller') as Controller;
    if (delays) {
      await Misc.delay(10_000);
    }
    const token = await Deploy.deployRemote(signer);
    if (delays) {
      await Misc.delay(10_000);
    }
    const ve = await Deploy.deployVe(signer, token.address, controller.address);
    if (delays) {
      await Misc.delay(10_000);
    }
    const gaugesFactory = await Deploy.deployGaugeFactory(signer);
    if (delays) {
      await Misc.delay(10_000);
    }
    const bribesFactory = await Deploy.deployBribeFactory(signer);
    if (delays) {
      await Misc.delay(10_000);
    }


    const veDist = await Deploy.deployVeDist(signer, ve.address);
    if (delays) {
      await Misc.delay(10_000);
    }
    const voter = await Deploy.deployRemoteVoter(signer, ve.address, baseFactory, gaugesFactory.address, bribesFactory.address);
    if (delays) {
      await Misc.delay(10_000);
    }
    const minter = await Deploy.deployRemoteMinter(signer, ve.address, controller.address);
    if (delays) {
      await Misc.delay(10_000);
    }

    await Misc.runAndWait(() => token.setMinter(minter.address), true, delays);
    await Misc.runAndWait(() => veDist.setDepositor(minter.address), true, delays);
    await Misc.runAndWait(() => controller.setVeDist(veDist.address), true, delays);
    await Misc.runAndWait(() => controller.setVoter(voter.address), true, delays);

    await Misc.runAndWait(() => voter.initialize(voterTokens, minter.address), true, delays);
    await Misc.runAndWait(() => minter.initialize(
      minterClaimants,
      minterClaimantsAmounts,
      minterSum,
      warmingUpPeriod
    ), false, delays);

    return [
      controller,
      token,
      gaugesFactory,
      bribesFactory,
      ve,
      veDist,
      voter,
      minter,
    ];
  }

}
