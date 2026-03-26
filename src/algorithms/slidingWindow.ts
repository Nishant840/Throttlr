import client from "../config/redis";

interface SlidingWindowResult{
    allowed: boolean,
    remaining: number,
    resetAt: number
}

export async function slidingWindow(
    key: string,
    limit: number,
    windowSizeInSeconds: number
): Promise<SlidingWindowResult>{

    const now = Date.now();
    const windowStart = now - windowSizeInSeconds*1000;

    const requests = await client.zRangeByScore(key,windowStart,now);
    const requestCount = requests.length;

    if(requestCount >= limit){
        return {
            allowed: false,
            remaining: 0,
            resetAt: now + windowSizeInSeconds*1000
        };
    }

    await client.zAdd(key,{score:now, value: `${now}`});
    await client.expire(key,windowSizeInSeconds);

    return {
        allowed: true,
        remaining: limit-requestCount-1,
        resetAt: now+windowSizeInSeconds*1000
    };
}