SELECT 'CREATE DATABASE pooleno_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'pooleno_test')\gexec
