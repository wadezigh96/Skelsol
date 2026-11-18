import { describe, expect, it } from "vitest";

import {
  buildInscription,
  InscriptionError,
  parseInscription,
  verifyInscription,
  type Inscription,
  type InscriptionInput,
} from "./inscription.js";

const MINT = "11111111111111111111111111111111";

function buildError(input: InscriptionInput): unknown {
  try {
    buildInscription(input);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("buildInscription", () => {
  it("produces canonical SPL-20-style inscription JSON", () => {
    const json = buildInscription({
      tick: "GHOST",
      amt: "1",
      mint: MINT,
    });
    expect(json).toBe(
      '{"p":"spl-20","op":"mint","tick":"GHOST","amt":"1","mint":"11111111111111111111111111111111"}',
    );
  });

  it.each([
    ["a lowercase tick", "ghost"],
    ["a tick with a dash", "GHOST-1"],
    ["a tick with a space", "GHOST 1"],
    ["an empty tick", ""],
    ["a tick longer than 10 chars", "GHOSTGHOST1"],
  ])("rejects %s", (_label, tick) => {
    const error = buildError({ tick, amt: "1", mint: MINT });
    expect(error).toBeInstanceOf(InscriptionError);
    expect((error as InscriptionError).reason).toBe("invalid-tick");
    expect((error as InscriptionError).message).toMatch(/tick/i);
  });

  it("accepts an amount given as a number", () => {
    const json = buildInscription({ tick: "GHOST", amt: 5, mint: MINT });
    expect(json).toBe(
      '{"p":"spl-20","op":"mint","tick":"GHOST","amt":"5","mint":"11111111111111111111111111111111"}',
    );
  });

  it.each([
    ["zero", "0"],
    ["a negative amount", "-1"],
    ["a fractional amount", "1.5"],
    ["scientific notation", "1e3"],
    ["an empty amount", ""],
    ["an amount with a leading space", " 1"],
    ["an amount with a leading zero", "01"],
    ["a non-numeric amount", "one"],
  ])("rejects %s given as a string", (_label, amt) => {
    const error = buildError({ tick: "GHOST", amt, mint: MINT });
    expect(error).toBeInstanceOf(InscriptionError);
    expect((error as InscriptionError).reason).toBe("invalid-amount");
    expect((error as InscriptionError).message).toMatch(/amount/i);
  });

  it.each([
    ["zero", 0],
    ["a negative amount", -5],
    ["a fractional amount", 1.5],
    ["NaN", Number.NaN],
    ["an unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects %s given as a number", (_label, amt) => {
    const error = buildError({ tick: "GHOST", amt, mint: MINT });
    expect(error).toBeInstanceOf(InscriptionError);
    expect((error as InscriptionError).reason).toBe("invalid-amount");
  });

  it.each([
    ["an empty mint address", ""],
    ["a mint address with invalid base58 characters", "not-an-address!!!"],
    ["a mint address that is too short", "1111111111111111111111111111111"],
    ["a mint address that is too long", "111111111111111111111111111111111"],
  ])("rejects %s", (_label, mint) => {
    const error = buildError({ tick: "GHOST", amt: "1", mint });
    expect(error).toBeInstanceOf(InscriptionError);
    expect((error as InscriptionError).reason).toBe("invalid-mint");
    expect((error as InscriptionError).message).toMatch(/mint/i);
  });
});

describe("parseInscription", () => {
  const VALID_JSON =
    '{"p":"spl-20","op":"mint","tick":"GHOST","amt":"1","mint":"11111111111111111111111111111111"}';

  it("accepts valid inscription JSON", () => {
    const result = parseInscription(VALID_JSON);
    expect(result).toEqual({
      ok: true,
      inscription: {
        p: "spl-20",
        op: "mint",
        tick: "GHOST",
        amt: "1",
        mint: MINT,
      } satisfies Inscription,
    });
  });

  it("round-trips a built inscription", () => {
    const json = buildInscription({ tick: "GHOST", amt: 7, mint: MINT });
    const result = parseInscription(json);
    expect(result).toEqual({
      ok: true,
      inscription: {
        p: "spl-20",
        op: "mint",
        tick: "GHOST",
        amt: "7",
        mint: MINT,
      } satisfies Inscription,
    });
  });

  it("accepts valid JSON regardless of field order", () => {
    const result = parseInscription(
      '{"mint":"11111111111111111111111111111111","amt":"1","tick":"GHOST","op":"mint","p":"spl-20"}',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.inscription.tick).toBe("GHOST");
    }
  });

  it("accepts valid JSON with extra whitespace", () => {
    const result = parseInscription(
      '  { "p" : "spl-20" , "op" : "mint" , "tick" : "GHOST" , "amt" : "1" , "mint" : "11111111111111111111111111111111" }  ',
    );
    expect(result.ok).toBe(true);
  });

  it("rejects malformed JSON without throwing", () => {
    expect(() => parseInscription("{not json")).not.toThrow();
    expect(() => parseInscription("")).not.toThrow();
    const result = parseInscription("{not json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InscriptionError);
      expect(result.error.reason).toBe("invalid-json");
      expect(result.error.message).toMatch(/not valid JSON/i);
    }
  });

  it.each([
    ["a JSON array", "[]"],
    ["a JSON number", "42"],
    ["JSON null", "null"],
    ["a JSON string", '"hello"'],
    ["a missing mint field", '{"p":"spl-20","op":"mint","tick":"GHOST","amt":"1"}'],
    [
      "a non-string amount",
      '{"p":"spl-20","op":"mint","tick":"GHOST","amt":1,"mint":"11111111111111111111111111111111"}',
    ],
  ])("rejects %s as an invalid shape", (_label, json) => {
    const result = parseInscription(json);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid-shape");
    }
  });

  it("rejects a different protocol", () => {
    const result = parseInscription(
      '{"p":"brc-20","op":"mint","tick":"GHOST","amt":"1","mint":"11111111111111111111111111111111"}',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid-protocol");
      expect(result.error.message).toMatch(/spl-20/i);
    }
  });

  it.each([["transfer"], ["list"], ["burn"]])(
    "rejects the unknown operation %s",
    (op) => {
      const result = parseInscription(
        `{"p":"spl-20","op":"${op}","tick":"GHOST","amt":"1","mint":"11111111111111111111111111111111"}`,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toBe("unknown-operation");
        expect(result.error.message).toMatch(/mint/i);
      }
    },
  );

  it("rejects a bad tick in the JSON", () => {
    const result = parseInscription(
      '{"p":"spl-20","op":"mint","tick":"ghost","amt":"1","mint":"11111111111111111111111111111111"}',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid-tick");
    }
  });

  it("rejects a non-positive amount in the JSON", () => {
    const result = parseInscription(
      '{"p":"spl-20","op":"mint","tick":"GHOST","amt":"0","mint":"11111111111111111111111111111111"}',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid-amount");
    }
  });

  it("rejects a malformed mint address in the JSON", () => {
    const result = parseInscription(
      '{"p":"spl-20","op":"mint","tick":"GHOST","amt":"1","mint":"not-an-address"}',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid-mint");
    }
  });
});

describe("verifyInscription", () => {
  const ghost: Inscription = {
    p: "spl-20",
    op: "mint",
    tick: "GHOST",
    amt: "1",
    mint: MINT,
  };

  it("accepts an inscription whose tick matches the collection", () => {
    expect(verifyInscription(ghost, "GHOST")).toEqual({ ok: true });
  });

  it("accepts a parsed inscription from a round-trip", () => {
    const json = buildInscription({ tick: "GHOST", amt: "1", mint: MINT });
    const parsed = parseInscription(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(verifyInscription(parsed.inscription, "GHOST")).toEqual({
        ok: true,
      });
    }
  });

  it("rejects an inscription whose tick belongs to another collection", () => {
    const result = verifyInscription(ghost, "SPOOK");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InscriptionError);
      expect(result.error.reason).toBe("tick-mismatch");
      expect(result.error.message).toMatch(/GHOST/);
      expect(result.error.message).toMatch(/SPOOK/);
    }
  });

  it("rejects an inscription with a malformed mint address", () => {
    const result = verifyInscription({ ...ghost, mint: "not-an-address" }, "GHOST");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid-mint");
    }
  });

  it("rejects an inscription with a missing mint address", () => {
    const result = verifyInscription({ ...ghost, mint: "" }, "GHOST");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid-mint");
    }
  });
});
