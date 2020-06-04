const fse = require("fs-extra");
const settings = require("./deploy-settings.json");
const StakingContract = artifacts.require("./SimpleDAIStaking.sol");
const Reserve = artifacts.require("./GoodReserveCDai.sol");
const DAIMock = artifacts.require("./DAIMock.sol");
const cDAIMock = artifacts.require("./cDAIMock.sol");
const DaiFaucet = artifacts.require("./RopstenDaiFaucetMock.sol");
const GoodDollar = artifacts.require("./GoodDollar.sol");
const UBIScheme = artifacts.require("./UBIScheme.sol");

module.exports = async function(deployer, network) {
  if (network.indexOf("production") >= 0) {
    return;
  }
  await deployer;
  const networkSettings = settings[network] || settings["default"];
  const accounts = await web3.eth.getAccounts();
  const staking_file = await fse.readFile("releases/deployment.json", "utf8");
  const dao_file = await fse.readFile("../releases/deployment.json", "utf8");
  const staking_deployment = await JSON.parse(staking_file);
  const dao_deployment = await JSON.parse(dao_file);

  let staking_mainnet_addresses, staking_sidechain_addresses, dao_sidechain_addresses;

  if (network === "develop") {
    staking_mainnet_addresses = staking_deployment[network];
    staking_sidechain_addresses = staking_deployment[network];
    dao_sidechain_addresses = dao_deployment[network];
  }
  else {
    staking_mainnet_addresses = staking_deployment[network + "-mainnet"];
    staking_sidechain_addresses = staking_deployment[network];
    dao_sidechain_addresses = dao_deployment[network];
  }

  // not mainnet, including develop
  if (network.indexOf("mainnet") < 0) {
    const goodDollar = await GoodDollar.at(dao_sidechain_addresses.GoodDollar);
    const ubi = await UBIScheme.at(staking_sidechain_addresses.UBIScheme);

    await goodDollar.mint(accounts[0], "10000000");
    await goodDollar.transfer(ubi.address, "5000000");
  }
  
  if (network.indexOf("mainnet") >= 0 || network === "develop") {
    const dai = await DAIMock.at(staking_mainnet_addresses.DAI);
    const cDAI = await cDAIMock.at(staking_mainnet_addresses.cDAI);
    const simpleStaking = await StakingContract.at(staking_mainnet_addresses.DAIStaking);
    const goodReserve = await Reserve.at(staking_mainnet_addresses.Reserve);

    if (network.indexOf("mainnet") >= 0) {
      console.log("get dai from faucet");
      const faucet = await DaiFaucet.at(networkSettings.daiFaucetAddress);
      await faucet.allocateTo(accounts[0], web3.utils.toWei("100", "ether"));
    }
    else {
      console.log("minting dai");
      await dai.mint(accounts[0], web3.utils.toWei("100", "ether"));
    }

    const approveStaking = dai.approve(simpleStaking.address, web3.utils.toWei("80", "ether"));
    const approveMinting = dai.approve(cDAI.address, web3.utils.toWei("20", "ether"));
    
    console.log("approving...");
    await Promise.all([approveStaking, approveMinting]);

    let ownercDaiBalanceBefore = await cDAI.balanceOf(accounts[0]);

    const staking = simpleStaking.stakeDAI(web3.utils.toWei("80", "ether"));
    const minting = cDAI.mint(web3.utils.toWei("20", "ether"));

    console.log("staking and minting...");
    await Promise.all([staking, minting]);

    let ownercDaiBalanceAfter = await cDAI.balanceOf(accounts[0]);
    
    let totalMinted = ownercDaiBalanceAfter.sub(ownercDaiBalanceBefore);

    const preloadStaking = cDAI.transfer(
      simpleStaking.address, 
      (Math.floor(totalMinted.toNumber() / 2)).toString());

    const approveCdai = cDAI.approve(
      goodReserve.address,
      (Math.floor(totalMinted.toNumber() / 2)).toString());
    
    console.log("preload staking contract and increase the cdai allowance to preload the reserve contract...");
    await Promise.all([preloadStaking, approveCdai]);
    
    console.log("preload reserve with CDAI");
    await goodReserve.buy(cDAI.address, (Math.floor(totalMinted.toNumber() / 2)).toString(), 0);
  }
};
