/**
 * 좌석 페이지 초기 마운트 실측 스크립트.
 *
 * React DevTools 확장 대신 `__REACT_DEVTOOLS_GLOBAL_HOOK__` 최소 구현을 페이지 로드 전에
 * 주입한다. React는 이 훅이 있으면 커밋마다 `onCommitFiberRoot`를 호출하고, 프로파일러
 * 타이머가 켜진 빌드(dev 빌드 또는 `next build --profile`)에서는 루트 fiber의
 * `actualDuration`에 그 커밋의 실제 렌더 시간이 누적돼 있다. DevTools Profiler가 커밋
 * 막대에 표시하는 값과 같은 출처다.
 *
 * 사용:
 *   node scripts/perf/measure-initial-mount.mjs --url http://localhost:3100/sessions/session-01/seats \
 *     --runs 5 --label after --out docs/assets/perf/after.json
 *
 * Playwright는 이 저장소의 의존성이 아니다. 다음 순서로 찾는다.
 *   1) PLAYWRIGHT_PATH 환경변수 (chromium을 포함한 playwright 패키지 경로)
 *   2) 로컬 node_modules/playwright
 *   3) npm 전역 설치본 (dev-browser 등)
 */

import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const args = {
    url: "http://localhost:3000/sessions/session-01/seats",
    runs: 5,
    label: "run",
    out: "",
    headed: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--url") args.url = argv[(i += 1)];
    else if (key === "--runs") args.runs = Number(argv[(i += 1)]);
    else if (key === "--label") args.label = argv[(i += 1)];
    else if (key === "--out") args.out = argv[(i += 1)];
    else if (key === "--headed") args.headed = true;
  }

  return args;
}

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    "playwright",
    `${process.env.APPDATA ?? ""}/npm/node_modules/dev-browser/node_modules/playwright`,
    `${process.env.HOME ?? ""}/.npm-global/lib/node_modules/dev-browser/node_modules/playwright`,
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // 다음 후보로 넘어간다.
    }
  }

  throw new Error(
    "playwright를 찾지 못했다. PLAYWRIGHT_PATH에 playwright 패키지 경로를 지정한다.",
  );
}

// 페이지의 모든 스크립트보다 먼저 실행된다. React가 주입 여부를 판단할 때 읽는 필드만
// 채운 최소 훅이다. isDisabled가 참이면 React가 주입을 건너뛰므로 반드시 false여야 한다.
function installReactHook() {
  const commits = [];
  const longTasks = [];

  function fiberName(fiber) {
    const type = fiber.type;
    if (typeof type === "function") return type.displayName || type.name || null;
    if (type && typeof type === "object") {
      // memo / forwardRef 는 내부 함수를 감싼 객체다.
      const inner = type.type || type.render;
      if (typeof inner === "function") {
        return inner.displayName || inner.name || null;
      }
    }
    return null;
  }

  // 커밋 시점의 fiber 트리를 훑어 컴포넌트 타입별 actualDuration을 합친다.
  // 프로덕션 번들은 함수 이름이 minify되므로 이름이 아니라 타입 동일성으로 묶고,
  // 인스턴스가 가장 많은 타입(2,000개)을 좌석 컴포넌트로 본다. before/after 모두
  // 좌석 하나당 컴포넌트 하나라는 구조가 같아 이 기준이 양쪽에 그대로 적용된다.
  function collectComponentDurations(rootFiber) {
    if (!rootFiber) {
      return { rootActualDuration: null, seat: null, topTypes: [] };
    }

    const byType = new Map();
    const stack = [rootFiber];

    while (stack.length > 0) {
      const fiber = stack.pop();
      const type = fiber.type;
      const isComponent =
        typeof type === "function" || (type && typeof type === "object");

      if (isComponent && typeof fiber.actualDuration === "number") {
        const entry = byType.get(type) ?? {
          name: fiberName(fiber),
          count: 0,
          actualDuration: 0,
        };
        entry.count += 1;
        entry.actualDuration += fiber.actualDuration;
        byType.set(type, entry);
      }

      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }

    const entries = [...byType.values()];
    const seat = entries.reduce(
      (max, entry) => (max === null || entry.count > max.count ? entry : max),
      null,
    );

    return {
      rootActualDuration: rootFiber.actualDuration ?? null,
      seat,
      topTypes: entries
        .sort((a, b) => b.actualDuration - a.actualDuration)
        .slice(0, 8),
    };
  }

  window.__perfCommits = commits;
  window.__perfLongTasks = longTasks;

  const noop = () => {};

  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    isDisabled: false,
    supportsFiber: true,
    renderers: new Map(),
    checkDCE: noop,
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot(_id, root) {
      const current = root && root.current;
      commits.push({
        at: performance.now(),
        actualDuration:
          current && typeof current.actualDuration === "number"
            ? current.actualDuration
            : null,
        treeBaseDuration:
          current && typeof current.treeBaseDuration === "number"
            ? current.treeBaseDuration
            : null,
        // 커밋 전체 시간은 페이지 셸까지 포함한다. 좌석맵에 귀속되는 몫을 따로 보려면
        // fiber 트리를 걸어 컴포넌트별 actualDuration을 모아야 한다.
        components: collectComponentDurations(current),
      });
    },
    onPostCommitFiberRoot: noop,
    onCommitFiberUnmount: noop,
    onScheduleFiberRoot: noop,
    setStrictMode: noop,
    getFiberRoots: () => new Set(),
    registerInternalModuleStart: noop,
    registerInternalModuleStop: noop,
    emit: noop,
    on: noop,
    off: noop,
    sub: () => noop,
  };

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({ start: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: "longtask", buffered: true });
  } catch {
    // longtask를 지원하지 않는 브라우저에서는 비워 둔다.
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function round(value) {
  return value === null || value === undefined
    ? null
    : Math.round(value * 10) / 10;
}

async function measureOnce(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.addInitScript(installReactHook);

  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(
    () => window.__perfCommits && window.__perfCommits.length > 0,
    undefined,
    { timeout: 30_000 },
  );
  // 하이드레이션 직후의 후속 커밋까지 잡히도록 잠깐 더 둔다. 3초 폴링 커밋은 제외한다.
  await page.waitForTimeout(1_500);

  // 좌석 하나를 실제로 클릭해 업데이트 커밋 비용을 잰다. before는 2,000개 좌석이 모두
  // 리렌더되고, after는 좌석 1개만 리렌더되는 대신 2,000개 파생 atom이 다시 계산된다.
  const clickTarget = await page.evaluate(() => {
    // 현재 구현은 ZoomPanSvg가 확대된 상태로 시작해 좌석 대부분이 뷰포트 밖에 있다.
    // 화면 안에 실제로 보이는 예매 가능 좌석을 골라야 클릭이 좌석에 닿는다.
    const visible = [...document.querySelectorAll("svg rect")].filter((rect) => {
      const box = rect.getBoundingClientRect();
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      return (
        box.width > 2 &&
        centerX > 0 &&
        centerY > 0 &&
        centerX < window.innerWidth &&
        centerY < window.innerHeight &&
        document.elementFromPoint(centerX, centerY) === rect
      );
    });

    const target = visible[Math.floor(visible.length / 2)];
    if (!target) return null;

    const box = target.getBoundingClientRect();
    window.__clickMarkedAt = performance.now();
    return {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      seatId: target.querySelector("title")?.textContent ?? null,
      visibleCount: visible.length,
    };
  });

  let clickCommits = [];
  if (clickTarget) {
    await page.mouse.click(clickTarget.x, clickTarget.y);
    await page.waitForTimeout(500);
    // 클릭 커밋에서는 루트 actualDuration만 읽는다. 바로 직전 커밋에서 bailout된 fiber는
    // 이전 커밋의 actualDuration을 그대로 들고 있어 타입별 합계가 오염되기 때문이다.
    // 루트 값은 이번 커밋에 실제로 렌더된 작업만 누적한다.
    clickCommits = await page.evaluate(() =>
      window.__perfCommits
        .filter((commit) => commit.at >= window.__clickMarkedAt)
        .map((commit) => ({
          at: commit.at,
          actualDuration: commit.actualDuration,
        })),
    );
  }

  const result = await page.evaluate(() => {
    const paint = performance.getEntriesByType("paint");
    const navigation = performance.getEntriesByType("navigation")[0];
    // 좌석은 before/after 모두 `<svg>` 안의 `<rect>`다. 클래스 이름은 Day 3과 현재가
    // 다르므로(neutral 팔레트 → --seat-* 토큰) 태그로만 센다.
    const seatCount = document.querySelectorAll("svg rect").length;

    return {
      commits: window.__perfCommits.slice(0, 5),
      commitCount: window.__perfCommits.length,
      longTasks: window.__perfLongTasks,
      firstContentfulPaint:
        paint.find((entry) => entry.name === "first-contentful-paint")
          ?.startTime ?? null,
      domContentLoaded: navigation?.domContentLoadedEventEnd ?? null,
      loadEvent: navigation?.loadEventEnd ?? null,
      seatCount,
    };
  });

  await context.close();

  const first = result.commits[0];
  // 하이드레이션 구간(첫 커밋 전후 1초 이내)의 longtask만 센다. 폴링 커밋은 제외된다.
  const hydrationWindowEnd = first.at + 1_000;
  const blockingDuringMount = result.longTasks
    .filter((task) => task.start <= hydrationWindowEnd)
    .reduce((sum, task) => sum + task.duration, 0);

  const components = first.components ?? {};
  const seat = components.seat ?? null;

  // 클릭 직후 첫 커밋이 선택 상태 갱신 커밋이다. 3초 폴링 커밋이 같은 창에 들어올 수
  // 있으므로 첫 커밋만 쓰고 나머지는 참고용으로 남긴다.
  const clickCommit = clickCommits[0] ?? null;

  return {
    mountActualDuration: first.actualDuration,
    mountTreeBaseDuration: first.treeBaseDuration,
    mountCommitAt: first.at,
    seatComponentsActualDuration: seat ? seat.actualDuration : null,
    seatComponentInstances: seat ? seat.count : 0,
    topTypes: (components.topTypes ?? []).map((entry) => ({
      name: entry.name,
      count: entry.count,
      actualDuration: round(entry.actualDuration),
    })),
    firstContentfulPaint: result.firstContentfulPaint,
    domContentLoaded: result.domContentLoaded,
    loadEvent: result.loadEvent,
    clickCommitActualDuration: clickCommit ? clickCommit.actualDuration : null,
    clickCommitCount: clickCommits.length,
    clickedSeatId: clickTarget ? clickTarget.seatId : null,
    longTaskTotalDuringMount: blockingDuringMount,
    longTaskCount: result.longTasks.length,
    commitCount: result.commitCount,
    seatCount: result.seatCount,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: !args.headed });

  const runs = [];
  // 첫 회차는 서버 캐시와 브라우저 JIT가 식은 상태라 버린다.
  const total = args.runs + 1;

  for (let i = 0; i < total; i += 1) {
    const run = await measureOnce(browser, args.url);
    const discarded = i === 0;
    if (!discarded) runs.push(run);
    console.log(
      `${discarded ? "warmup" : `run ${i}`}: mount=${round(run.mountActualDuration)}ms ` +
        `seats=${round(run.seatComponentsActualDuration)}ms/${run.seatComponentInstances} ` +
        `click=${round(run.clickCommitActualDuration)}ms ` +
        `fcp=${round(run.firstContentfulPaint)}ms rects=${run.seatCount} commits=${run.commitCount}`,
    );
  }

  await browser.close();

  const summary = {
    label: args.label,
    url: args.url,
    measuredAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: `${os.platform()} ${os.release()}`,
      cpu: os.cpus()[0]?.model ?? "unknown",
      cores: os.cpus().length,
      headless: !args.headed,
    },
    runs,
    median: {
      mountActualDuration: round(median(runs.map((r) => r.mountActualDuration))),
      seatComponentsActualDuration: round(
        median(runs.map((r) => r.seatComponentsActualDuration ?? 0)),
      ),
      clickCommitActualDuration: round(
        median(runs.map((r) => r.clickCommitActualDuration ?? 0)),
      ),
      firstContentfulPaint: round(median(runs.map((r) => r.firstContentfulPaint))),
      longTaskTotalDuringMount: round(
        median(runs.map((r) => r.longTaskTotalDuringMount)),
      ),
      seatCount: median(runs.map((r) => r.seatCount)),
    },
  };

  console.log("\n=== median ===");
  console.log(JSON.stringify(summary.median, null, 2));

  if (args.out) {
    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(`\nwrote ${args.out}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
