// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// VRFV2PlusClient - Chainlink VRF v2.5 client library
// Minimal reproduction of Chainlink's VRFV2PlusClient for VRF v2.5 requests.
// Based on chainlink contracts v1.3.0.
library VRFV2PlusClient {
    bytes4 private constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));

    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }

    struct ExtraArgsV1 {
        bool nativePayment;
    }

    function _argsToBytes(ExtraArgsV1 memory extraArgs) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, extraArgs);
    }
}
