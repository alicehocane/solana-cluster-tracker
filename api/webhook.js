import { createClient } from '@supabase/supabase-js';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "https://discord.com/api/webhooks/1545746746242498620/LjsCpbblr-07w1Gi9GcQrTn39MspeX6sn8lnTbkvcFEJKKjG0x_gFS1QcYlD1eago97-";

// Initialize Supabase Client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

const TRACKED_WALLETS = new Set([
    "9oKGw6n6tjGC7mGuS4PLRYx1xSMt2pAzFdCibUjdaX2m",
    "3VMW45SQTeSxFrSozjBbx49qqQ2z6HKUezvakAPwHwhz",
    "GkVZ6BRP3nd8LYwCAdniVdTS2R8zniRbkN5tZhhvLBtY",
    "835GEJgjDt4B4LzC33vYpt6dQXUWJqkkVnWVnGP3WUKN",
    "7UDarSsvMu64SDyL5dayANca8za87tbyeuAdGjMKWf16",
    "7iG1nhuNPXjUq2D2LJXywBE1zAXQQFzDFvf7hKNjZf26",
    "BgpLrxjCPFrvqEUQNrMxhP7ZmDNbjwcaX8fzy3ZuYvzT",
    "BQdbTPv9iuPjU6swSVJEsdv3hutS1UxFstTpx4KRVZEm",
    "3Qchg1ipMKRoqDktu27yNMvcPe3xTHD9q7uJe6Xtbua2",
    "4w8St7tNUNqgAXvXd4BjhkByV1w9vagp2yjUyrnoU4ZS",
    "Ggnm2KVizsXedUrBJqjXtg8ztgCw3C5P6swVfSiFQ2SH",
    "8eGqytw6HWhykdBoA9gNWZv7t7vYr6X8KeoDABU1731y",
    "3bwkvwoYnyC9GMVFn2EWeAJ2YptCnZDWdc284SdWD2gd",
    "3pLheGVtmHLe5xDpVXWLLPmcKquNLTGMEmzTofxLmoCC",
    "8mNGKZAsSwgmhrkVnvhmcuSDW3Bt5s1GSS7uzd93DcmV",
    "BHREKFkPQgAtDs8Vb1UfLkUpjG6ScidTjHaCWFuG2AtX",
    "Hj7UJq2DFqYdPv7JZzWWiRcNG36vD8knmWbggBfXNc51",
    "ALaYhQti7bcSb1MNFjkz4TPTeHKCvdCy3ivN8tmQdh35",
    "5xwjQ3s8jytQ4nBYnBbzM34xSGWtjRAy8dwn9vPKtGNS",
    "E8tXebsK9bKkr44YSkfnmmWftGzcFZboHJcVMt3Kis4w",
    "CTnhDdpKCdRBNXocZgGh4aeM1vxTSsXLT68CTAZLUzWD",
    "ETRwCdhkKYQk6HK58zGAd8aEEpTQuMUBwXhEfG9v2Jb3",
    "CnjMc5DeNmhPSYZ2xFpNqtKGuU8ETTKHqUQwicapboDj",
    "L2vRhKZsQcRUHvy1PEY4dCJ37XhfqHzgRrgAgfs4FFN",
    "ETwAcPeN87KmFm8xPBsSiQCuqnyLgLdU9qevbf5t8KLn"
]);

const BLACKLISTED_TOKENS = new Set([
    "So11111111111111111111111111111111111111112", // Wrapped SOL
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

const MIN_SOL_SPEND = 0.05; 
const HOLDING_CHECK_MS = 3 * 60 * 1000; // 3 Minutes

async function sendDiscordAlert(message) {
    try {
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: message })
        });
    } catch (error) {
        console.error("Failed to send Discord notification:", error);
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    res.status(200).json({ status: 'received' });

    try {
        const transactions = req.body;
        if (!Array.isArray(transactions)) return;

        const now = Date.now();

        for (const tx of transactions) {
            if (tx.type !== 'SWAP') continue;

            const targetAccount = tx.accountData?.find(acc => 
                TRACKED_WALLETS.has(acc.account)
            );

            if (!targetAccount) continue;
            const involvedTrackedWallet = targetAccount.account;

            const tokenTransfer = tx.tokenTransfers?.find(transfer => 
                transfer.toUserAccount === involvedTrackedWallet || transfer.fromUserAccount === involvedTrackedWallet
            );

            if (!tokenTransfer) continue;
            const tokenMint = tokenTransfer.mint;
            if (BLACKLISTED_TOKENS.has(tokenMint)) continue;

            const isBuy = tokenTransfer.toUserAccount === involvedTrackedWallet;
            const isSell = tokenTransfer.fromUserAccount === involvedTrackedWallet;

            // 1. IF IT'S A SELL: Mark any pending buy for this wallet/token as cancelled (Dumped under 3 mins)
            if (isSell) {
                await supabase
                    .from('tracked_pending_buys')
                    .update({ status: 'cancelled' })
                    .eq('wallet', involvedTrackedWallet)
                    .eq('token_mint', tokenMint)
                    .eq('status', 'pending');
                continue;
            }

            // 2. IF IT'S A BUY: Record it as pending in Supabase
            if (isBuy) {
                const solSpent = Math.abs(targetAccount.nativeBalanceChange) / 1e9;
                if (solSpent < MIN_SOL_SPEND) continue;

                await supabase.from('tracked_pending_buys').insert([
                    {
                        wallet: involvedTrackedWallet,
                        token_mint: tokenMint,
                        buy_timestamp: now,
                        sol_spent: solSpent,
                        status: 'pending'
                    }
                ]);
            }
        }

        // 3. CHECK FOR SURVIVING BUYS (Passed the 3-minute mark without selling)
        const threeMinutesAgo = now - HOLDING_CHECK_MS;
        
        const { data: matureBuys, error } = await supabase
            .from('tracked_pending_buys')
            .select('*')
            .eq('status', 'pending')
            .lte('buy_timestamp', threeMinutesAgo);

        if (error || !matureBuys) return;

        // Process mature buys to check cluster confluence and notify
        for (const buy of matureBuys) {
            // Mark as verified so we don't alert twice
            await supabase
                .from('tracked_pending_buys')
                .update({ status: 'verified' })
                .eq('id', buy.id);

            // Check how many other unique wallets bought this token within a 30-minute window of this buy
            const thirtyMinsBefore = buy.buy_timestamp - (30 * 60 * 1000);
            const thirtyMinsAfter = buy.buy_timestamp + (30 * 60 * 1000);

            const { data: clusterData } = await supabase
                .from('tracked_pending_buys')
                .select('wallet')
                .eq('token_mint', buy.token_mint)
                .gte('buy_timestamp', thirtyMinsBefore)
                .lte('buy_timestamp', thirtyMinsAfter);

            if (!clusterData) continue;

            // Extract unique other wallets
            const uniqueWallets = [...new Set(clusterData.map(c => c.wallet))].filter(w => w !== buy.wallet);

            if (uniqueWallets.length > 0) {
                const shortWallet = `${buy.wallet.slice(0, 4)}...${buy.wallet.slice(-4)}`;
                const shortToken = `${buy.token_mint.slice(0, 4)}...${buy.token_mint.slice(-4)}`;
                let probabilityScore = uniqueWallets.length >= 3 ? "🔥 HIGH PUMP PROBABILITY 🔥" : "⚡ Medium ⚡";

                const message = 
                    `🚨 **CONFLUENCE ALERT (3-Min Hold Verified)** 🚨\n\n` +
                    `🪙 **Token:** \`${shortToken}\`\n` +
                    `👤 **Buyer:** \`${shortWallet}\` (Spent ~${Number(buy.sol_spent).toFixed(2)} SOL)\n` +
                    `👥 **Cluster Activity:** **${uniqueWallets.length} other tracked wallets** also held this past 3 mins.\n` +
                    `📊 **Status:** ${probabilityScore}\n\n` +
                    `🔗 [Dexscreener](https://dexscreener.com/solana/${buy.token_mint}) | [Solscan](https://solscan.io/token/${buy.token_mint})`;

                await sendDiscordAlert(message);
            }
        }

    } catch (err) {
        console.error("Error processing transaction batch:", err);
    }
}