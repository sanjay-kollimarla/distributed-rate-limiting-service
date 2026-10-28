-- Sliding-window log, evaluated atomically inside Redis.
-- KEYS[1]  sorted set of request timestamps
-- ARGV[1]  limit (max requests per window)
-- ARGV[2]  window length in ms
-- ARGV[3]  unique member for this request
-- Returns  { allowed (0|1), remaining, retryAfterMs, resetAfterMs }

local limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])

local time = redis.call('TIME')
local now_ms = time[1] * 1000 + math.floor(time[2] / 1000)

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now_ms - window_ms)

local allowed = 0
if redis.call('ZCARD', KEYS[1]) < limit then
  redis.call('ZADD', KEYS[1], now_ms, ARGV[3])
  redis.call('PEXPIRE', KEYS[1], window_ms)
  allowed = 1
end

local count = redis.call('ZCARD', KEYS[1])
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local reset_after_ms = 0
if oldest[2] ~= nil then
  reset_after_ms = math.max(0, math.ceil(tonumber(oldest[2]) + window_ms - now_ms))
end

local retry_after_ms = 0
if allowed == 0 then
  retry_after_ms = reset_after_ms
end

return { allowed, limit - count, retry_after_ms, reset_after_ms }
