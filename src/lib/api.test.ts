/** The API client: auth headers, error text, tokens, and waiting for a sleeping server. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError, detailText, getKidToday, getMe, getPlan, listGoalHabits, redeemPoints, request, resetWakeState,
  setExpiredListener, setPin, setWakingListener, signInDev,
} from "./api";
import { getCaregiverToken, getKidSession, saveCaregiverToken, saveKidSession } from "./storage";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn<typeof fetch>();
const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
const lastInit = () => lastCall()[1]!;

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("VITE_API_URL", "https://api.test/");
  fetchMock.mockReset();
  resetWakeState();
  setExpiredListener(() => {});
  setWakingListener(() => {});
  saveCaregiverToken("care", 3600);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("requests", () => {
  it("sends the caregiver token to the base URL without a double slash", async () => {
    fetchMock.mockResolvedValue(json(200, { id: "u", families: [] }));
    await getMe();
    expect(lastCall()[0]).toBe("https://api.test/v1/me");
    expect(lastInit().headers).toMatchObject({ Authorization: "Bearer care" });
  });

  it("sends the kid token only to kid endpoints", async () => {
    saveKidSession("kiddo", 3600, "c1", "Alex");
    fetchMock.mockResolvedValue(json(200, {}));
    await getKidToday();
    expect(lastInit().headers).toMatchObject({ Authorization: "Bearer kiddo" });
    await getPlan("c1");
    expect(lastInit().headers).toMatchObject({ Authorization: "Bearer care" });
  });

  it("posts the dev login as a form without a token", async () => {
    fetchMock.mockResolvedValue(json(200, { access_token: "t", token_type: "bearer", expires_in: 3600 }));
    await signInDev("parent:test 2", "p&w");
    expect(lastInit().body).toBe("username=parent%3Atest+2&password=p%26w");
    expect(lastInit().headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
  });

  it("sends JSON bodies and builds habit queries", async () => {
    fetchMock.mockResolvedValue(json(201, { entry: {}, points: 5 }));
    await redeemPoints("c1", 20, "Movie night");
    expect(lastInit().headers).toMatchObject({ "Content-Type": "application/json" });
    expect(lastInit().body).toBe('{"points":20,"note":"Movie night"}');
    fetchMock.mockResolvedValue(json(200, []));
    await listGoalHabits("sleep", 7, 2);
    expect(lastCall()[0]).toBe("https://api.test/v1/goals/sleep/habits?age=7&max_tier=2");
  });

  it("treats 204 as no content", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(setPin("f1", "1234")).resolves.toBeUndefined();
  });
});

describe("errors", () => {
  it("shows detail strings as written", async () => {
    fetchMock.mockResolvedValue(json(422, { detail: "Not enough points: 5 available" }));
    await expect(redeemPoints("c1", 20, "x")).rejects.toMatchObject({ status: 422, detail: "Not enough points: 5 available" });
  });

  it("says so when the server's dev login is turned off", async () => {
    fetchMock.mockResolvedValue(json(404, { detail: "Not Found" }));
    await expect(signInDev("parent", "secret")).rejects.toMatchObject({
      status: 404, detail: "The development login is turned off on this server. Please use Google sign-in.",
    });
  });

  it("joins validation errors into one line", () => {
    expect(detailText({ detail: [{ msg: "Value error, PIN must be 4 digits", loc: ["body", "pin"] }, { msg: "Too long" }] }, 422))
      .toBe("PIN must be 4 digits Too long");
  });

  it("has a readable fallback when the body has no detail", () => {
    expect(detailText(null, 500)).toBe("The server had a problem. Please try again.");
  });

  it("a caregiver 401 clears the token and tells the app", async () => {
    const onExpired = vi.fn();
    setExpiredListener(onExpired);
    fetchMock.mockResolvedValue(json(401, { detail: "Authentication required" }));
    await expect(getMe()).rejects.toBeInstanceOf(ApiError);
    expect(onExpired).toHaveBeenCalledOnce();
    expect(getCaregiverToken()).toBeNull();
  });

  it("a kid 401 clears only the kid token", async () => {
    const onExpired = vi.fn();
    setExpiredListener(onExpired);
    saveKidSession("kiddo", 3600, "c1", "Alex");
    fetchMock.mockResolvedValue(json(401, { detail: "Authentication required" }));
    await expect(getKidToday()).rejects.toMatchObject({ status: 401 });
    expect(getKidSession()).toBeNull();
    expect(getCaregiverToken()).not.toBeNull();
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("does not call the API with an expired token", async () => {
    saveCaregiverToken("old", -1);
    await expect(getMe()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a failed sign-in is an ordinary error, not an expired session", async () => {
    const onExpired = vi.fn();
    setExpiredListener(onExpired);
    fetchMock.mockResolvedValue(json(401, { detail: "Wrong username or password" }));
    await expect(signInDev("parent", "nope")).rejects.toMatchObject({ detail: "Wrong username or password" });
    expect(onExpired).not.toHaveBeenCalled();
  });
});

describe("waking the server", () => {
  beforeEach(() => void vi.useFakeTimers());

  it("gives the first call 70 seconds and later warm calls 30", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockImplementation(async () => json(200, {}));
    await getMe();
    expect(timeout).toHaveBeenLastCalledWith(70_000);
    await getMe();
    expect(timeout).toHaveBeenLastCalledWith(30_000);
    timeout.mockRestore();
  });

  it("announces a slow cold call and clears the notice when it lands", async () => {
    const waking = vi.fn();
    setWakingListener(waking);
    let finish: (r: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const call = getMe();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(waking).toHaveBeenLastCalledWith(true);
    finish(json(200, {}));
    await call;
    expect(waking).toHaveBeenLastCalledWith(false);
  });

  it("does not announce waking for a warm call", async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    await getMe();
    const waking = vi.fn();
    setWakingListener(waking);
    let finish: (r: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const call = getMe();
    await vi.advanceTimersByTimeAsync(5_000);
    finish(json(200, {}));
    await call;
    expect(waking).not.toHaveBeenCalled();
  });

  it("retries while the proxy says the app is still starting", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(json(200, { id: "u" }));
    const call = getMe();
    await vi.advanceTimersByTimeAsync(3_100);
    await expect(call).resolves.toMatchObject({ id: "u" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a connection failure on a cold call, but not on a warm one", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("failed")).mockResolvedValueOnce(json(200, {}));
    const cold = getMe();
    await vi.advanceTimersByTimeAsync(3_100);
    await cold;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRejectedValueOnce(new TypeError("failed"));
    await expect(request("GET", "/v1/me")).rejects.toMatchObject({ status: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("explains a timeout instead of showing a raw abort", async () => {
    fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(getMe()).rejects.toMatchObject({ detail: "The server is taking too long to answer. Please try again." });
  });
});
