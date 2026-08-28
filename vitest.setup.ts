import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";

// The default findBy*/waitFor timeout is 1000ms, which the full suite exceeds
// on loaded machines even though each file passes in isolation.
configure({ asyncUtilTimeout: 5000 });

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

/*
 * jsdom 30은 HTMLDialogElement 생성자와 `open` 프로퍼티는 제공하지만
 * showModal()/close()는 구현하지 않는다. `open` 속성에 따라 display가
 * none ↔ block으로 정확히 계산되므로, 속성만 토글하면 toBeVisible() 기반
 * 검증은 그대로 성립한다. 포커스 트랩과 top-layer는 브라우저 몫이라
 * 여기서 흉내 내지 않는다 — 테스트가 검증하는 것은 열림/닫힘 계약뿐이다.
 */
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}
