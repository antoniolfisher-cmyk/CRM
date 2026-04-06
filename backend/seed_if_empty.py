"""Seed the DB with sample data only on first run (empty database)."""
import sys
from database import engine, SessionLocal
import models

models.Base.metadata.create_all(bind=engine)

db = SessionLocal()
try:
    count = db.query(models.Account).count()
finally:
    db.close()

if count == 0:
    print("Empty database — seeding sample data...")
    try:
        import seed  # noqa: F401
        print("Seed complete.")
    except Exception as e:
        print(f"Warning: seed failed ({e}), continuing anyway.")
else:
    print(f"Database has {count} accounts — skipping seed.")
