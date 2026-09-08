import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ErrorNotice, UnauthorizedNotice } from "./admin-query";

describe("UnauthorizedNotice", () => {
  it("만료 문구와 다시 로그인 버튼을 alert로 알린다", () => {
    render(<UnauthorizedNotice />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "로그인이 만료되었습니다.",
    );
    expect(
      screen.getByRole("button", { name: "다시 로그인" }),
    ).toBeInTheDocument();
  });
});

describe("ErrorNotice", () => {
  it("전달받은 문구를 alert로 알린다", () => {
    render(<ErrorNotice>운영 현황을 불러오지 못했습니다.</ErrorNotice>);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "운영 현황을 불러오지 못했습니다.",
    );
  });
});
