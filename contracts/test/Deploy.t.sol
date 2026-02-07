// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../script/Deploy.s.sol";

/// @title Deploy Tests
/// @notice Tests the deployment script against a local fork
contract DeployTest is Test {
    Deploy public deployScript;

    function setUp() public {
        deployScript = new Deploy();

        // Set up environment for testing
        // Private key for anvil default account[0]
        vm.setEnv("DEPLOYER_PRIVATE_KEY", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    }

    /// @notice Test deployment on a simulated Base Sepolia
    function test_Deployment_BaseSepolia() public {
        // Simulate Base Sepolia chain ID
        vm.chainId(84532);

        // Run deployment
        deployScript.run();

        // If we get here without reverting, deployment succeeded
        assertTrue(true);
    }

    /// @notice Test deployment on a simulated Base Mainnet
    function test_Deployment_BaseMainnet() public {
        // Simulate Base Mainnet chain ID
        vm.chainId(8453);

        // Run deployment
        deployScript.run();

        // If we get here without reverting, deployment succeeded
        assertTrue(true);
    }
}
