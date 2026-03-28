import client from "../config/redis";

interface SlidingWindowResult{
    allowed: boolean,
    remaining: number,
    resetAt: number
}

const slidingWindowLua = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local windowStart = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])
    local windowSize = tonumber(ARGV[4])

    redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)

    local count = redis.call('ZCARD', key)

    if count>=limit then
        return {0, 0, now+(windowSize*1000)}
    end

    redis.call('ZADD', key, now, tostring(now))
    redis.call('EXPIRE', key, windowSize)

    return {1, limit-count-1, now+(windowSize*1000)}
`;
export async function slidingWindow(
    key: string,
    limit: number,
    windowSizeInSeconds: number
): Promise<SlidingWindowResult>{

    const now = Date.now();
    const windowStart = now - windowSizeInSeconds*1000;

    const result = await client.eval(slidingWindowLua,{
        keys: [key],
        arguments: [
            now.toString(),
            windowStart.toString(),
            limit.toString(),
            windowSizeInSeconds.toString()
        ]
    }) as [number, number, number];

    return {
        allowed: result[0]===1,
        remaining: result[1],
        resetAt: result[2]
    };
}