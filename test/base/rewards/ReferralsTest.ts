import {
  RemotePair,
  RemotePair__factory,
  Gauge,
  Gauge__factory,
  Token
} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import chai from "chai";
import {CoreAddresses} from "../../../scripts/deploy/CoreAddresses";
import {Deploy} from "../../../scripts/deploy/Deploy";
import {BigNumber, utils} from "ethers";
import {TestHelper} from "../../TestHelper";
import {TimeUtils} from "../../TimeUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";

const {expect} = chai;

const amount1000At6 = parseUnits('1000', 6);
const WEEK = 60 * 60 * 24 * 7;

describe("referrals test", function () {

  let snapshotBefore: string;
  let snapshot: string;

  let owner: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;
  let owner4: SignerWithAddress;
  let owner5: SignerWithAddress;
  let core: CoreAddresses;
  let ust: Token;
  let mim: Token;
  let wmatic: Token;
  let mimUstPair: RemotePair;
  let gaugeMimUst: Gauge;

  before(async function () {
    snapshotBefore = await TimeUtils.snapshot();
    [owner, owner2, owner3, owner4, owner5] = await ethers.getSigners();

    wmatic = await Deploy.deployContract(owner, 'Token', 'WMATIC', 'WMATIC', 18, owner.address) as Token;
    await wmatic.mint(owner.address, parseUnits('100000'));

    [ust, mim] = await TestHelper.createMockTokensAndMint(owner);
    await ust.transfer(owner2.address, utils.parseUnits('100', 6));
    await mim.transfer(owner2.address, utils.parseUnits('100'));

    await ust.transfer(owner3.address, utils.parseUnits('100', 6));
    await mim.transfer(owner3.address, utils.parseUnits('100'));

    await ust.transfer(owner4.address, utils.parseUnits('100', 6));
    await mim.transfer(owner4.address, utils.parseUnits('100'));
    await ust.transfer(owner5.address, utils.parseUnits('100', 6));
    await mim.transfer(owner5.address, utils.parseUnits('100'));

    core = await Deploy.deployCore(
      owner,
      wmatic.address,
      [wmatic.address, ust.address, mim.address, /*dai.address*/],
      [owner.address, owner2.address, owner.address],
      [utils.parseUnits('100'), utils.parseUnits('100'), BigNumber.from(100)],
      utils.parseUnits('200').add(100),
      2,
        false
    );

    mimUstPair = await TestHelper.addLiquidity(
      core.factory,
      core.router,
      owner,
      mim.address,
      ust.address,
      utils.parseUnits('1'),
      utils.parseUnits('1', 6),
      true
    );

    // ------------- setup gauges and bribes --------------

    await core.token.approve(core.voter.address, BigNumber.from("1500000000000000000000000"));
    await core.voter.createGauge(mimUstPair.address);
    expect(await core.voter.gauges(mimUstPair.address)).to.not.equal(0x0000000000000000000000000000000000000000);

    const gaugeMimUstAddress = await core.voter.gauges(mimUstPair.address);

    gaugeMimUst = Gauge__factory.connect(gaugeMimUstAddress, owner);

    await TestHelper.depositToGauge(owner, gaugeMimUst, mimUstPair, amount1000At6, 1);

    expect(await gaugeMimUst.totalSupply()).to.equal(amount1000At6);
    expect(await gaugeMimUst.earned(core.ve.address, owner.address)).to.equal(0);
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

  it("ve boost test", async function () {
    await core.voter.vote(1, [mimUstPair.address], [100]);
    const veBal = await core.ve.balanceOfNFT(2)
    expect(veBal).is.not.eq(0);
    expect(await core.ve.balanceOf(owner3.address)).is.eq(0);

    // await depositToGauge(core, owner2, mim.address, ust.address, gaugeMimUst, 2);
    await depositToGauge(core, owner3, mim.address, ust.address, gaugeMimUst, 0);

    await TimeUtils.advanceBlocksOnTs(WEEK * 2);
    await core.minter.updatePeriod()
    await core.voter.distributeAll();

    await TimeUtils.advanceBlocksOnTs(WEEK);

    // await gaugeMimUst.connect(owner2).getReward(owner2.address, [core.token.address]);
    await gaugeMimUst.connect(owner3).getReward(owner3.address, [core.token.address]);

    await gaugeMimUst.connect(owner3).withdrawAll();

    await core.token.connect(owner3).transfer(owner4.address, BigNumber.from(100000));
    await core.token.connect(owner3).transfer(owner5.address, BigNumber.from(100000));
    await core.token.connect(owner4).approve(core.ve.address, BigNumber.from(100000));
    await core.token.connect(owner5).approve(core.ve.address, BigNumber.from(100000));
    await core.ve.connect(owner4).createLock(BigNumber.from(100000), 60 * 60 * 24 * 365 * 4, 2);
    await core.ve.connect(owner5).createLock(BigNumber.from(100000), 60 * 60 * 24 * 365 * 4, 0);
    expect(await core.ve.balanceOf(owner4.address)).is.eq('1');

    await depositToGauge(core, owner4, mim.address, ust.address, gaugeMimUst, 4);
    await depositToGauge(core, owner5, mim.address, ust.address, gaugeMimUst, 5);

    await TimeUtils.advanceBlocksOnTs(WEEK);

    const reward1 = await gaugeMimUst.earned(core.token.address, owner4.address);
    const reward2 = await gaugeMimUst.earned(core.token.address, owner5.address);
    const refReward1 = await gaugeMimUst.refEarned(core.token.address, 2);

    console.log("Earned for NFT with referrer", formatUnits(reward1));
    console.log("Earned for NFT without referrer", formatUnits(reward2));
    console.log("Referrer earned", formatUnits(refReward1));

    await gaugeMimUst.connect(owner4).getReward(owner4.address, [core.token.address]);
    expect(await gaugeMimUst.earned(core.token.address, owner4.address)).to.eq(0)
    await gaugeMimUst.connect(owner5).getReward(owner5.address, [core.token.address]);
    expect(await gaugeMimUst.earned(core.token.address, owner5.address)).to.eq(0)
    await gaugeMimUst.connect(owner2).getRefReward(2, [core.token.address]);
    expect(await gaugeMimUst.refEarned(core.token.address, 2)).to.eq(0)

    // todo: cover max boost limit
  });

});

async function depositToGauge(
  core: CoreAddresses,
  owner: SignerWithAddress,
  token0: string,
  token1: string,
  gauge: Gauge,
  tokenId: number
) {
  await TestHelper.addLiquidity(
    core.factory,
    core.router,
    owner,
    token0,
    token1,
    utils.parseUnits('1'),
    utils.parseUnits('1', 6),
    true
  );
  const pairAdr = await core.factory.getPair(token0, token1, true)
  const pair = RemotePair__factory.connect(pairAdr, owner);
  const pairBalance = await pair.balanceOf(owner.address);
  expect(pairBalance).is.not.eq(0);
  await pair.approve(gauge.address, pairBalance);
  await gauge.connect(owner).deposit(pairBalance, tokenId);
}
