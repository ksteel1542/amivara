-- Urhobo was stored as 'ur' (ISO 639 for Urdu). Its ISO 639-3 code is 'urh'.
UPDATE profiles SET languages = array_replace(languages, 'ur', 'urh') WHERE 'ur' = ANY (languages);
