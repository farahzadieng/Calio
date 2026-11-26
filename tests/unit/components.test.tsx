// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, Input, Textarea } from "../../src/components/ui/primitives";

afterEach(cleanup);

describe("Calio form primitives", () => {
  it("associates validation text and keeps Persian input unchanged while typing", () => {
    const changed = vi.fn();
    render(
      <Input
        label="وزن (کیلوگرم)"
        error="وزن معتبر وارد کنید."
        inputMode="decimal"
        onChange={changed}
      />,
    );
    const input = screen.getByRole("textbox", { name: "وزن (کیلوگرم)" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const description = input.getAttribute("aria-describedby");
    expect(document.getElementById(description ?? "")?.textContent).toBe(
      "وزن معتبر وارد کنید.",
    );
    fireEvent.change(input, { target: { value: "۷۰٫۵" } });
    expect(changed).toHaveBeenCalledTimes(1);
    expect((input as HTMLInputElement).value).toBe("۷۰٫۵");
  });

  it("retains textarea semantics and gives plain buttons a safe type inside forms", () => {
    const submit = vi.fn();
    render(
      <form onSubmit={submit}>
        <Textarea label="Note" />
        <Button>Cancel</Button>
      </form>,
    );
    expect(screen.getByRole("textbox", { name: "Note" }).tagName).toBe(
      "TEXTAREA",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(submit).not.toHaveBeenCalled();
  });
});
