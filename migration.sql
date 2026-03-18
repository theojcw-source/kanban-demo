CREATE TABLE IF NOT EXISTS kanban_columns (
  id text PRIMARY KEY,
  title text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kanban_cards (
  id text PRIMARY KEY,
  col_id text NOT NULL REFERENCES kanban_columns(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE kanban_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanban_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow all" ON kanban_columns FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow all" ON kanban_cards FOR ALL USING (true) WITH CHECK (true);

INSERT INTO kanban_columns (id, title, position) VALUES
  ('todo', 'To Do', 0),
  ('in-progress', 'In Progress', 1),
  ('done', 'Done', 2)
ON CONFLICT (id) DO NOTHING;
