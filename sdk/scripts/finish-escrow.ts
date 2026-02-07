import { createPublicClient, createWalletClient, http, keccak256, toHex, formatUnits } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const ESCROW = '0xBb2f0Eb0f064b62E2116fd79C12dA1dcEb58B695';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
if (!PRIVATE_KEY) {
  console.error('PRIVATE_KEY environment variable required');
  process.exit(1);
}
const CLIENT_PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY as `0x${string}`;
if (!CLIENT_PRIVATE_KEY) {
  console.error('CLIENT_PRIVATE_KEY environment variable required');
  process.exit(1);
}

const usdcAbi = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const;

const escrowAbi = [
  { name: 'confirmDelivery', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'escrowId', type: 'uint256' }, { name: 'outputHash', type: 'bytes32' }], outputs: [] },
  { name: 'releaseEscrow', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'escrowId', type: 'uint256' }], outputs: [] },
] as const;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const providerAccount = privateKeyToAccount(PRIVATE_KEY);
  const clientAccount = privateKeyToAccount(CLIENT_PRIVATE_KEY);
  
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org') });
  const providerWallet = createWalletClient({ account: providerAccount, chain: baseSepolia, transport: http('https://sepolia.base.org') });
  const clientWallet = createWalletClient({ account: clientAccount, chain: baseSepolia, transport: http('https://sepolia.base.org') });

  const escrowId = 2n;
  const outputHash = keccak256(toHex('Code review complete: No issues found'));

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║          COMPLETING ESCROW #2                             ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const providerBefore = await publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [providerAccount.address] });
  console.log('Provider USDC before:', formatUnits(providerBefore, 6));

  // Step 1: Provider confirms delivery
  console.log('\n━━━ STEP 5: Provider Confirms Delivery ━━━');
  console.log('   ⏳ Performing code review...');
  await sleep(1500);
  console.log('   ✅ Work complete!');
  
  const confirmHash = await providerWallet.writeContract({ 
    address: ESCROW, abi: escrowAbi, functionName: 'confirmDelivery', 
    args: [escrowId, outputHash] 
  });
  console.log('   TX:', confirmHash.slice(0, 22) + '...');
  await publicClient.waitForTransactionReceipt({ hash: confirmHash });
  console.log('   ✅ Delivery confirmed on-chain!');

  // Step 2: Client releases payment
  console.log('\n━━━ STEP 6: Client Releases Payment ━━━');
  await sleep(2000);
  const releaseHash = await clientWallet.writeContract({ 
    address: ESCROW, abi: escrowAbi, functionName: 'releaseEscrow', 
    args: [escrowId] 
  });
  console.log('   TX:', releaseHash.slice(0, 22) + '...');
  await publicClient.waitForTransactionReceipt({ hash: releaseHash });
  console.log('   ✅ Payment released!');

  // Final check
  console.log('\n━━━ FINAL RESULT ━━━');
  const providerAfter = await publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [providerAccount.address] });
  const escrowBalance = await publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [ESCROW] });
  
  console.log('Provider USDC after:', formatUnits(providerAfter, 6));
  console.log('Escrow contract balance:', formatUnits(escrowBalance, 6));
  console.log('\n🎉 Provider earned: +' + formatUnits(providerAfter - providerBefore, 6) + ' USDC!');

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║              ESCROW COMPLETE ✅                            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('\nView on Basescan:');
  console.log('  https://sepolia.basescan.org/tx/' + releaseHash);
}

main().catch(e => console.error('❌', e.shortMessage || e.message));
