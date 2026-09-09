import { z } from "zod";

import {
  OPERATIONS_SUMMARY_ROW_LIMIT,
  neutralizeUserInput,
  selectOperationsSummaryRows,
} from "@/lib/ai-prompt";
import {
  collectOperations,
  type OperationsFilter,
} from "@/lib/operations";
import type { SeatStore, ShowStore } from "@/services";

export interface OpsReadStores {
  showStore: Pick<ShowStore, "list" | "get">;
  seatStore: Pick<SeatStore, "getSnapshot">;
}

export interface OpsToolDescriptor<Schema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  inputSchema: Schema;
  run: (args: z.infer<Schema>) => Promise<string>;
}

/* 운영 요약과 Tool이 같은 컨텍스트 상한을 공유하는 것은 의도된 정책이다. */
export const OPS_TOOL_ROW_LIMIT = OPERATIONS_SUMMARY_ROW_LIMIT;

const listShowsInputSchema = z.object({});
const listOperationsInputSchema = z.object({
  showId: z.string().min(1).optional(),
  date: z.iso.date().optional(),
});

function wrapUserInput(value: string): string {
  return [
    "===USER_INPUT_START===",
    neutralizeUserInput(value),
    "===USER_INPUT_END===",
  ].join("\n");
}

export function createOpsTools(stores: OpsReadStores): OpsToolDescriptor[] {
  return [
    {
      name: "list_shows",
      description:
        "공연 제목을 공연 ID로 바꾸거나 조회할 공연을 고를 때 사용한다. 입력은 없으며 전체 공연의 id와 title을 반환한다.",
      inputSchema: listShowsInputSchema,
      async run() {
        const shows = await stores.showStore.list();

        return JSON.stringify({
          shows: shows.map((show) => ({
            id: show.id,
            title: wrapUserInput(show.title),
          })),
        });
      },
    },
    {
      name: "list_operations",
      description:
        "회차별 좌석 운영 현황을 조회할 때 사용한다. showId는 특정 공연, date는 YYYY-MM-DD 형식의 특정 날짜를 필터링하며 둘 다 생략하면 전체 회차를 조회한다.",
      inputSchema: listOperationsInputSchema,
      async run(args) {
        const filter = listOperationsInputSchema.parse(args) as OperationsFilter;
        const rows = await collectOperations(stores, filter);
        const { rows: selectedRows, omittedCount } =
          selectOperationsSummaryRows(rows);

        return JSON.stringify({
          totalRows: rows.length,
          returnedRows: selectedRows.length,
          omittedRows: omittedCount,
          ...(omittedCount > 0
            ? {
                notice: `전체 ${rows.length}개 회차 중 판매율 상위 ${selectedRows.length}개만 반환했고 ${omittedCount}개를 제외했다.`,
              }
            : {}),
          operations: selectedRows.map((row) => ({
            ...row,
            showTitle: wrapUserInput(row.showTitle),
          })),
        });
      },
    },
  ];
}
