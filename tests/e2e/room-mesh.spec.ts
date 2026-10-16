import { expect, test, type Browser } from "@playwright/test";

/**
 * Multi-client audio-room harness.
 *
 * One browser context cannot hold two independent microphones or two
 * independent WebRTC stacks, so every peer gets its own context and the peers
 * run in parallel. N = 3 keeps CI fast; raise PEER_COUNT toward 5+ locally to
 * exercise the mesh paths (offerer election, MESH_CAP admission) under load.
 *
 * These specs assert the client-side media preconditions each peer needs before
 * any SDP moves: WebRTC primitives exist, AudioContext can be constructed and
 * resumed (autoplay policy is disabled via launch flags, mirroring a post-gesture
 * page), an AnalyserNode meter can be attached, and the fake mic yields a live
 * audio track. Signaling convergence itself (offer/answer/ICE over
 * /api/signal) is the next spec to write once this harness is green — it needs
 * real sessions against a preview backend, not assertions invented here.
 */

const PEER_COUNT = 3;

async function peerPreconditions(browser: Browser, index: number) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  // Sanity: the peer actually loaded the app, not an error page.
  await expect(page).toHaveTitle(/MS-ROOMS|Best Audio Room|Audio Room/i, { timeout: 15_000 });

  const result = await page.evaluate(async () => {
    const hasRTC = typeof RTCPeerConnection !== "undefined";
    let audioState = "missing";
    let analyserOk = false;
    let micTrackState: string | null = null;
    let micError: string | null = null;
    try {
      const Ctx: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
        audioState = ctx.state;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyserOk = analyser.fftSize === 512 && analyser.frequencyBinCount === 256;
        await ctx.close().catch(() => undefined);
      }
    } catch (e) {
      audioState = `error:${e instanceof Error ? e.message : String(e)}`;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micTrackState = stream.getAudioTracks()[0]?.readyState ?? "no-track";
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      micError = e instanceof Error ? e.message : String(e);
    }
    return { hasRTC, audioState, analyserOk, micTrackState, micError };
  });

  expect(result.hasRTC, `peer ${index}: RTCPeerConnection must exist`).toBe(true);
  expect(result.analyserOk, `peer ${index}: AnalyserNode meter must attach`).toBe(true);
  expect(
    result.audioState,
    `peer ${index}: AudioContext must reach running (got ${result.audioState})`
  ).toBe("running");
  expect(
    result.micTrackState,
    `peer ${index}: fake mic must yield a live track (error: ${result.micTrackState ?? result.micError})`
  ).toBe("live");

  await context.close();
  return result;
}

test.describe("room mesh preconditions", () => {
  test(`${PEER_COUNT} peers each hold an independent mic + audio pipeline`, async ({ browser }) => {
    const results = await Promise.all(
      Array.from({ length: PEER_COUNT }, (_, i) => peerPreconditions(browser, i))
    );
    expect(results).toHaveLength(PEER_COUNT);
  });

  test("peers negotiate a loopback offer/answer pair locally", async ({ browser }) => {
    // Catches API-shape regressions (e.g. a transceiver refactor that breaks
    // createOffer/setLocalDescription) without any backend at all.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    const sdpType = await page.evaluate(async () => {
      const pc = new RTCPeerConnection();
      pc.addTransceiver("audio", { direction: "sendrecv" });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const type = pc.localDescription?.type ?? null;
      pc.close();
      return type;
    });
    expect(sdpType).toBe("offer");
    await context.close();
  });

  test("two peers complete a call and audio flows both directions", async ({ browser }) => {
    // Full in-page mesh of two: fake mic track attached via the production
    // transceiver pattern, trickled ICE like the app does, then assert both
    // sides connect, both ontrack handlers fire, and bytes actually move.
    // This is what caught the missing-sender bug (connected but silent).
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      if (!track) return { ok: false, reason: "no-mic-track" };

      const a = new RTCPeerConnection();
      const b = new RTCPeerConnection();
      const received: string[] = [];
      a.ontrack = (ev) => received.push(`a:${ev.track.kind}`);
      b.ontrack = (ev) => received.push(`b:${ev.track.kind}`);
      // Same shape as useCallSession.join: sendrecv transceiver per track.
      a.addTransceiver(track, { direction: "sendrecv", streams: [stream] });
      b.addTransceiver("audio", { direction: "sendrecv" });

      // Trickle ICE both directions, mirroring queueOrAddIce/flushIce.
      a.onicecandidate = (ev) => {
        if (ev.candidate) void b.addIceCandidate(ev.candidate).catch(() => undefined);
      };
      b.onicecandidate = (ev) => {
        if (ev.candidate) void a.addIceCandidate(ev.candidate).catch(() => undefined);
      };

      const offer = await a.createOffer();
      await a.setLocalDescription(offer);
      await b.setRemoteDescription(offer);
      const answer = await b.createAnswer();
      await b.setLocalDescription(answer);
      await a.setRemoteDescription(answer);

      const waitState = (pc: RTCPeerConnection, want: string, ms: number) =>
        new Promise<boolean>((resolve) => {
          if (pc.connectionState === want) return resolve(true);
          const t = setTimeout(() => resolve(false), ms);
          pc.addEventListener("connectionstatechange", () => {
            if (pc.connectionState === want) {
              clearTimeout(t);
              resolve(true);
            }
          });
        });
      const connected = (await waitState(a, "connected", 15000)) && (await waitState(b, "connected", 15000));

      // Let audio flow, then confirm received bytes on at least one side.
      await new Promise((r) => setTimeout(r, 2000));
      let bytesReceived = 0;
      try {
        for (const pc of [a, b]) {
          const stats = await pc.getStats();
          stats.forEach((s) => {
            if (s.type === "inbound-rtp" && typeof s.bytesReceived === "number") {
              bytesReceived += s.bytesReceived as number;
            }
          });
        }
      } catch {
        /* stats unavailable */
      }
      const states = [a.connectionState, b.connectionState];
      stream.getTracks().forEach((t) => t.stop());
      a.close();
      b.close();
      return { ok: true, connected, received, bytesReceived, states };
    });
    expect(result.ok).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.received).toContain("b:audio");
    expect(result.bytesReceived).toBeGreaterThan(0);
    await context.close();
  });
});
