import {
  BribeFactory,
  Remote,
  RemoteFactory,
  RemoteMinter,
  RemoteRouter01,
  RemoteVoter, Controller,
  GaugeFactory,
  Ve,
  VeDist
} from "../../typechain";

export class CoreAddresses {

  readonly token: Remote;
  readonly gaugesFactory: GaugeFactory;
  readonly bribesFactory: BribeFactory;
  readonly factory: RemoteFactory;
  readonly router: RemoteRouter01;
  readonly ve: Ve;
  readonly veDist: VeDist;
  readonly voter: RemoteVoter;
  readonly minter: RemoteMinter;
  readonly controller: Controller;


  constructor(token: Remote, gaugesFactory: GaugeFactory, bribesFactory: BribeFactory, factory: RemoteFactory, router: RemoteRouter01, ve: Ve, veDist: VeDist, voter: RemoteVoter, minter: RemoteMinter, controller: Controller) {
    this.token = token;
    this.gaugesFactory = gaugesFactory;
    this.bribesFactory = bribesFactory;
    this.factory = factory;
    this.router = router;
    this.ve = ve;
    this.veDist = veDist;
    this.voter = voter;
    this.minter = minter;
    this.controller = controller;
  }
}
