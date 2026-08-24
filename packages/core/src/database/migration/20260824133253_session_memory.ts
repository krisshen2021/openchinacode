import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260824133253_session_memory",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_memory\` (
          \`session_id\` text PRIMARY KEY,
          \`content\` text NOT NULL,
          \`source\` text NOT NULL,
          \`version\` integer DEFAULT 1 NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_session_memory_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
