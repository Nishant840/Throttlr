import client from "../config/redis";

interface TokenBucketResult {
    allowed: boolean,
    remaining: number,
    resetAt: number
}

const tokenBucketLua = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local capacity = tonumber(ARGV[2])
    local refillRate = tonumber(ARGV[3])

    local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')

    local tokens = tonumber(bucket[1])
    local lastRefill = tonumber(bucket[2])

    if tokens == nil then
        tokens = capacity
        lastRefill = now
    end

    local elapsed = now - lastRefill
    local refill = math.floor(elapsed * refillRate / 1000)

    tokens = math.min(capacity, tokens + refill)
    lastRefill = now

    if tokens < 1 then
        redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
        redis.call('EXPIRE', key, math.ceil(capacity/refillRate))

        return {0, 0, now + math.ceil((1-tokens)/refillRate * 1000)}
    end

    tokens = tokens-1

    redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
    redis.call('EXPIRE', key, math.ceil(capacity/refillRate))

    return {1, tokens, now + math.ceil((capacity - tokens)/refillRate * 1000)}
`;

export async function tokenBucket(
    key: string,
    capacity: number,
    refillRate: number
): Promise<TokenBucketResult> {
    const now = Date.now();

    const result = await client.eval(tokenBucketLua, {
        keys: [key],
        arguments:[
            now.toString(),
            capacity.toString(),
            refillRate.toString()
        ]
    }) as [number, number, number];

    return {
        allowed: result[0] == 1,
        remaining: result[1],
        resetAt: result[2]
    };
}