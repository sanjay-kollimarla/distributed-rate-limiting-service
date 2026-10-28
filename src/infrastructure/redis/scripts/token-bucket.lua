-- Token bucket, evaluated atomically inside Redis.
-- KEYS[1]  bucket key
-- ARGV[1]  capacity (max tokens)
-- ARGV[2]  refill rate (tokens per second)
-- Returns  { allowed (0|1), remaining tokens, retryAfterMs, resetAfterMs }
-- Time comes from Redis so every app instance shares one clock.

local capacity = tonumber(ARGV[1])
local refill_per_second = tonumber(ARGV[2])

local time = redis.call('TIME')
local now_ms = time[1] * 1000 + math.floor(time[2] / 1000)

local state = redis.call('HMGET', KEYS[1], 'tokens', 'updated_at')
local tokens = tonumber(state[1])
local updated_at = tonumber(state[2])

if tokens == nil then
  tokens = capacity
  updated_at = now_ms
end

local elapsed_seconds = math.max(0, now_ms - updated_at) / 1000
tokens = math.min(capacity, tokens + elapsed_seconds * refill_per_second)

local allowed = 0
local retry_after_ms = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry_after_ms = math.ceil((1 - tokens) / refill_per_second * 1000)
end

redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'updated_at', now_ms)
-- An idle bucket refills completely, so it is indistinguishable from a new one.
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / refill_per_second * 1000) + 1000)

local reset_after_ms = math.ceil((capacity - tokens) / refill_per_second * 1000)
return { allowed, math.floor(tokens), retry_after_ms, reset_after_ms }
