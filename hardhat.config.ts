import {config as dotEnvConfig} from "dotenv";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-web3";
import "@nomiclabs/hardhat-solhint";
import "@typechain/hardhat";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import "hardhat-tracer";
import "hardhat-etherscan-abi";
import "solidity-coverage"
import "hardhat-abi-exporter"

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('')
  .options({
    hardhatChainId: {
      type: "number",
      default: 31337
    },
    bscRpcUrl: {
      type: "string",
      default: ''
    },
    bscTestnetRpcUrl: {
      type: "string",
      default: ''
    },
    fujiRpcUrl: {
      type: "string",
      default: ''
    },
    networkScanKey: {
      type: "string",
      default: ''
    },
    networkScanKeyFuji: {
      type: "string",
      default: ''
    },
    privateKey: {
      type: "string",
      default: "b55c9fcc2c60993e5c539f37ffd27d2058e7f77014823b461323db5eba817518" // random account
    },
    bscForkBlock: {
      type: "number",
      default: 0
    },
    bscTestForkBlock: {
      type: "number",
      default: 0
    },
  }).argv;


export default {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      chainId: !!argv.hardhatChainId ? argv.hardhatChainId : undefined,
      timeout: 99999 * 2,
      gas: argv.hardhatChainId === 56 ? 19_000_000 :
        argv.hardhatChainId === 97 ? 19_000_000 :
          undefined,
      forking: !!argv.hardhatChainId && argv.hardhatChainId !== 31337 ? {
        url:
          argv.hardhatChainId === 56 ? argv.bscRpcUrl :
          argv.hardhatChainId === 97 ? argv.bscTestnetRpcUrl :
              undefined,
        blockNumber:
          argv.hardhatChainId === 56 ? argv.bscForkBlock !== 0 ? argv.bscForkBlock : undefined :
          argv.hardhatChainId === 97 ? argv.bscTestForkBlock !== 0 ? argv.bscTestForkBlock : undefined :
              undefined
      } : undefined,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        path: "m/44'/60'/0'/0",
        accountsBalance: "100000000000000000000000000000"
      },
      // loggingEnabled: true
    },
    neondevnet: {
      url: 'https://devnet.neonevm.org',
      timeout: 99999,
      chainId: 245022926,
      network_id: 245022926,
      accounts: [argv.privateKey],
    },
    bsc: {
      url: argv.bscRpcUrl,
      timeout: 99999,
      chainId: 56,
      // gas: 19_000_000,
      // gasPrice: 100_000_000_000,
      // gasMultiplier: 1.3,
      accounts: [argv.privateKey],
    },
    bsctest: {
      url: argv.bscTestnetRpcUrl,
      chainId: 97,
      timeout: 99999,
      // gasPrice: 100_000_000_000,
      accounts: [argv.privateKey],
    },
    fuji: {
      url: argv.fujiRpcUrl || '',
      chainId: 43113,
      // gas: 50_000_000_000,
      accounts: [argv.privateKey],
    },
  },
  etherscan: {
    apiKey: {
      bsc: argv.networkScanKey,
      bscTestnet: argv.networkScanKey,
      avalancheFujiTestnet: argv.networkScanKeyFuji
    },
    customChains: []
  },
  solidity: {
    compilers: [
      {
        version: "0.8.15",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          }
        }
      },
    ]
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  mocha: {
    timeout: 9999999999
  },
  contractSizer: {
    alphaSort: false,
    runOnCompile: false,
    disambiguatePaths: false,
  },
  gasReporter: {
    enabled: false,
    currency: 'USD',
    gasPrice: 21
  },
  typechain: {
    outDir: "typechain",
  },
};
