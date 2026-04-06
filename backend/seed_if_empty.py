"""Run seed only if the database has no accounts yet."""
from database import engine, SessionLocal
import models

models.Base.metadata.create_all(bind=engine)

db = SessionLocal()
count = db.query(models.Account).count()
db.close()

if count == 0:
    print("Empty database — seeding sample data...")
    import seed  # noqa: F401
else:
    print(f"Database already has {count} accounts — skipping seed.")
