// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@openzeppelin/contracts/access/IAccessControl.sol";

/// @title DeployTimelock - Deploy TimelockController and transfer admin roles
/// @notice Deploys an OZ TimelockController with 24h delay, then transfers
///         DEFAULT_ADMIN_ROLE on all AgoraMesh contracts from the deployer to the timelock.
/// @dev Run AFTER DeployAll.s.sol. Requires existing deployment addresses.
///
///   Usage:
///     forge script script/DeployTimelock.s.sol \
///       --rpc-url base_sepolia --broadcast --verify \
///       --sig "run(address,address,address,address,address,address,address,address,address)"  \
///       <trustRegistry> <chainRegistry> <escrow> <disputes> <streaming> \
///       <crossChain> <namespaces> <agentToken> <nftReputation>
///
///   Or set DEPLOYED_ADDRESSES_JSON env var pointing to the deployment JSON
///   and use the no-arg run() which reads from the JSON.
contract DeployTimelock is Script {
    uint256 constant MIN_DELAY = 24 hours;
    bytes32 constant DEFAULT_ADMIN_ROLE = 0x00;

    struct ContractAddresses {
        address trustRegistry;
        address chainRegistry;
        address escrow;
        address disputes;
        address streaming;
        address crossChain;
        address namespaces;
        address agentToken;
        address nftReputation;
    }

    /// @notice Deploy timelock using addresses from deployment JSON
    function run() external {
        string memory json = vm.readFile(vm.envString("DEPLOYED_ADDRESSES_JSON"));

        ContractAddresses memory addrs = ContractAddresses({
            trustRegistry: vm.parseJsonAddress(json, ".trustRegistry"),
            chainRegistry: vm.parseJsonAddress(json, ".chainRegistry"),
            escrow: vm.parseJsonAddress(json, ".escrow"),
            disputes: vm.parseJsonAddress(json, ".disputes"),
            streaming: vm.parseJsonAddress(json, ".streaming"),
            crossChain: vm.parseJsonAddress(json, ".crossChain"),
            namespaces: vm.parseJsonAddress(json, ".namespaces"),
            agentToken: vm.parseJsonAddress(json, ".agentToken"),
            nftReputation: vm.parseJsonAddress(json, ".nftReputation")
        });

        _deploy(addrs);
    }

    /// @notice Deploy timelock with explicit contract addresses
    function run(
        address trustRegistry,
        address chainRegistry,
        address escrow,
        address disputes,
        address streaming,
        address crossChain,
        address namespaces,
        address agentToken,
        address nftReputation
    ) external {
        ContractAddresses memory addrs = ContractAddresses({
            trustRegistry: trustRegistry,
            chainRegistry: chainRegistry,
            escrow: escrow,
            disputes: disputes,
            streaming: streaming,
            crossChain: crossChain,
            namespaces: namespaces,
            agentToken: agentToken,
            nftReputation: nftReputation
        });

        _deploy(addrs);
    }

    function _deploy(ContractAddresses memory addrs) internal {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("========================================");
        console.log("  AGORAMESH TIMELOCK DEPLOYMENT");
        console.log("========================================");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Min Delay:", MIN_DELAY, "seconds (24 hours)");
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // --- Step 1: Deploy TimelockController ---
        console.log("--- Step 1: Deploying TimelockController ---");

        address[] memory proposers = new address[](1);
        proposers[0] = deployer;

        address[] memory executors = new address[](1);
        executors[0] = deployer;

        // admin = deployer (for initial setup; can be renounced later)
        TimelockController timelock = new TimelockController(
            MIN_DELAY,
            proposers,
            executors,
            deployer
        );
        console.log("  TimelockController:", address(timelock));

        // Grant CANCELLER_ROLE to deployer for emergency cancellation.
        // OZ constructor already grants CANCELLER_ROLE to proposers,
        // but we explicitly log it for clarity.
        console.log("  Deployer has PROPOSER_ROLE, EXECUTOR_ROLE, CANCELLER_ROLE");

        // --- Step 2: Grant DEFAULT_ADMIN_ROLE to timelock on all contracts ---
        console.log("\n--- Step 2: Granting DEFAULT_ADMIN_ROLE to Timelock ---");

        address[9] memory contracts = [
            addrs.trustRegistry,
            addrs.chainRegistry,
            addrs.escrow,
            addrs.disputes,
            addrs.streaming,
            addrs.crossChain,
            addrs.namespaces,
            addrs.agentToken,
            addrs.nftReputation
        ];

        string[9] memory names = [
            "TrustRegistry",
            "ChainRegistry",
            "AgoraMeshEscrow",
            "TieredDisputeResolution",
            "StreamingPayments",
            "CrossChainTrustSync",
            "VerifiedNamespaces",
            "AgentToken",
            "NFTBoundReputation"
        ];

        for (uint256 i = 0; i < contracts.length; i++) {
            IAccessControl(contracts[i]).grantRole(DEFAULT_ADMIN_ROLE, address(timelock));
            console.log("  ", names[i], "-> Timelock granted DEFAULT_ADMIN_ROLE");
        }

        // --- Step 3: Revoke DEFAULT_ADMIN_ROLE from deployer on all contracts ---
        console.log("\n--- Step 3: Revoking DEFAULT_ADMIN_ROLE from Deployer ---");

        for (uint256 i = 0; i < contracts.length; i++) {
            IAccessControl(contracts[i]).revokeRole(DEFAULT_ADMIN_ROLE, deployer);
            console.log("  ", names[i], "-> Deployer revoked DEFAULT_ADMIN_ROLE");
        }

        vm.stopBroadcast();

        // --- Step 4: Save timelock address ---
        console.log("\n--- Step 4: Summary ---");
        console.log("========================================");
        console.log("  TIMELOCK DEPLOYMENT COMPLETE");
        console.log("========================================");
        console.log("TimelockController:", address(timelock));
        console.log("Min Delay: 24 hours");
        console.log("Proposer:", deployer);
        console.log("Executor:", deployer);
        console.log("Canceller:", deployer);
        console.log("");
        console.log("All 9 contracts now require 24h timelock for admin ops.");
        console.log("Deployer admin role revoked on all contracts.");
        console.log("========================================");
    }
}
