import { sql } from "drizzle-orm";
import { check, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Everything the user has written. Row 1 holds the prompt answers as one block
 * (and the prompt cursor); each further row holds the comments on suggested actions gathered
 * between two presses of Generate Ideas. The newest of those is pending until the next press.
 */
export const dataBlock = sqliteTable("data_block", {
  id: integer("id").primaryKey(),
  body: text("body").notNull().default(""),
  /** Index of the next prompt to show. */
  promptCursor: integer("prompt_cursor").notNull().default(0),
  /** Comments still gathering, not yet folded into the considerations. */
  pending: integer("pending", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** The condensed considerations: 7 slots in one row (id = 1). */
export const consideration = sqliteTable("consideration", {
  id: integer("id").primaryKey(),
  slot1: text("slot1"),
  slot2: text("slot2"),
  slot3: text("slot3"),
  slot4: text("slot4"),
  slot5: text("slot5"),
  slot6: text("slot6"),
  slot7: text("slot7"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Sub-items of the considerations: each belongs to one of the 7 slots. Replaced on every condense. */
export const subconsideration = sqliteTable(
  "subconsideration",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** The consideration slot (1–7) this belongs to. */
    slot: integer("slot").notNull(),
    text: text("text").notNull(),
  },
  (t) => [check("subconsideration_slot_range", sql`${t.slot} between 1 and 7`)],
);

/**
 * The action generator's state (id = 1): the actions suggested so far, condensed into a short
 * list of general themes. Updated after every batch of generated actions.
 */
export const suggestedThemes = sqliteTable("suggested_themes", {
  id: integer("id").primaryKey(),
  themes: text("themes", { mode: "json" }).$type<string[]>().notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * The action generator's chosen state (id = 1): which considerations (by slot, 1–7) and which
 * passages of the person's writing it is shown. Re-chosen at random only by Generate Ideas.
 */
export const generationState = sqliteTable("generation_state", {
  id: integer("id").primaryKey(),
  slots: text("slots", { mode: "json" }).$type<number[]>().notNull(),
  passages: text("passages", { mode: "json" }).$type<string[]>().notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** A proposed action: a brief two-sentence idea. */
export const action = sqliteTable(
  "action",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    text: text("text").notNull(),
    /** How unpredictable the idea is for this person (0.0–1.0, 1 = most surprising; null until scored). */
    surprisingness: real("surprisingness"),
    /** When the action was suggested to the user; null = never shown. */
    shownAt: integer("shown_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [check("action_surprisingness_range", sql`${t.surprisingness} between 0 and 1`)],
);

/**
 * One row per action with 7 score slots (null until scored). Valence runs 0.0–1.0 with 1 as
 * the favourable end. Effort and risk run -1.0–1.0: effort -1 = effortless,
 * 1 = very demanding; risk -1 = completely safe, 1 = severe risk.
 */
function scoreTable(name: string, min = 0) {
  return sqliteTable(
    name,
    {
      actionId: integer("action_id")
        .primaryKey()
        .references(() => action.id, { onDelete: "cascade" }),
      slot1: real("slot1"),
      slot2: real("slot2"),
      slot3: real("slot3"),
      slot4: real("slot4"),
      slot5: real("slot5"),
      slot6: real("slot6"),
      slot7: real("slot7"),
    },
    (t) =>
      [t.slot1, t.slot2, t.slot3, t.slot4, t.slot5, t.slot6, t.slot7].map((s, i) =>
        check(`${name}_slot${i + 1}_range`, sql`${s} between ${sql.raw(String(min))} and 1`),
      ),
  );
}

export const effort = scoreTable("effort", -1);
export const valence = scoreTable("valence");
export const risk = scoreTable("risk", -1);

/** An action's three scores on one subconsideration (same scales as the score tables, null until scored). */
export const subScore = sqliteTable(
  "sub_score",
  {
    actionId: integer("action_id")
      .notNull()
      .references(() => action.id, { onDelete: "cascade" }),
    subconsiderationId: integer("subconsideration_id")
      .notNull()
      .references(() => subconsideration.id, { onDelete: "cascade" }),
    effort: real("effort"),
    valence: real("valence"),
    risk: real("risk"),
  },
  (t) => [
    primaryKey({ columns: [t.actionId, t.subconsiderationId] }),
    check("sub_score_effort_range", sql`${t.effort} between -1 and 1`),
    check("sub_score_valence_range", sql`${t.valence} between 0 and 1`),
    check("sub_score_risk_range", sql`${t.risk} between -1 and 1`),
  ],
);
