import {RemoteFactory, RemotePair__factory, Token} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import chai from "chai";
import {Deploy} from "../../../scripts/deploy/Deploy";
import {TimeUtils} from "../../TimeUtils";
import {Misc} from "../../../scripts/Misc";

const {expect} = chai;

describe("factory tests", function () {

  let snapshotBefore: string;
  let snapshot: string;

  let owner: SignerWithAddress;
  let owner2: SignerWithAddress;
  let factory: RemoteFactory;
  let wmatic: Token;
  let usdc: Token;


  before(async function () {
    snapshotBefore = await TimeUtils.snapshot();
    [owner, owner2] = await ethers.getSigners();
    wmatic = await Deploy.deployContract(owner, 'Token', 'WMATIC', 'WMATIC', 18, owner.address) as Token;
    usdc = await Deploy.deployContract(owner, 'Token', 'USDC', 'USDC', 6, owner.address) as Token;
    factory = await Deploy.deployRemoteFactory(owner);
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });


  beforeEach(async function () {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshot);
  });

  it("set pauser", async function () {
    await factory.setPauser(owner2.address);
    await factory.connect(owner2).acceptPauser();
    expect(await factory.pauser()).is.eq(owner2.address);
  });

  it("set pauser only from pauser", async function () {
    await expect(factory.connect(owner2).setPauser(owner2.address)).revertedWith("Not pauser");
  });

  it("accept pauser only from pending pauser", async function () {
    await factory.setPauser(owner2.address);
    await expect(factory.connect(owner).acceptPauser()).revertedWith("Not pending pauser");
  });

  it("pause", async function () {
    await factory.setPause(true);
    expect(await factory.isPaused()).is.eq(true);
  });

  it("pause only from pauser", async function () {
    await expect(factory.connect(owner2).setPause(true)).revertedWith("Not pauser");
  });

  it("create pair revert with the same tokens", async function () {
    await expect(factory.createPair(Misc.ZERO_ADDRESS, Misc.ZERO_ADDRESS, true)).revertedWith('IDENTICAL_ADDRESSES');
  });

  it("create pair revert with the zero token", async function () {
    await expect(factory.createPair(wmatic.address, Misc.ZERO_ADDRESS, true)).revertedWith('ZERO_ADDRESS');
  });

  it("set fees revert ", async function () {
    await expect(factory.connect(owner2).setSwapFee(wmatic.address, 1)).revertedWith("RemoteFactory: Not pauser");
  });

  it("check created pair variables", async function () {
    await factory.createPair(wmatic.address, usdc.address, true);
    await expect(factory.createPair(wmatic.address, usdc.address, true)).revertedWith('PAIR_EXISTS');
    const pairAdr = await factory.getPair(wmatic.address, usdc.address, true);
    const pair = RemotePair__factory.connect(pairAdr, owner);
    expect(await pair.factory()).eq(factory.address);
    expect(await pair.fees()).not.eq(Misc.ZERO_ADDRESS);
    expect(await pair.stable()).eq(true);
  });


});
