// reportAppError (app/error-actions.ts) lives under app/, which the node test
// glob does not reach, so its test sits here with the other server helpers.
//
// Development runs against the live project, so a dev server's errors used to
// land in production's app_errors: from 26.09 to 13.10, 24 of the 25 error
// groups on /admin/errors came from localhost (half-edited code, migrations not
// pushed yet). A dev server must not write there; a production build must.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn(async () => ({ data: null, error: null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "test" }) }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => ({ rpc }) }));

import { reportAppError } from "@/app/error-actions";

const error = { source: "client" as const, message: "boom", route: "/today" };

describe("reportAppError", () => {
  beforeEach(() => rpc.mockClear());
  afterEach(() => vi.unstubAllEnvs());

  it("writes nothing from a development server", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await reportAppError(error);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records the error from a production build", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await reportAppError(error);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_app_error", expect.objectContaining({ p_message: "boom", p_route: "/today" }));
  });
});
