ALTER TABLE connections
ADD COLUMN headers_json TEXT NOT NULL DEFAULT '{}'
CHECK (json_valid(headers_json) AND json_type(headers_json) = 'object');
