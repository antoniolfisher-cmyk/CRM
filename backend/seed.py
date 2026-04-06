"""Seed the database with sample wholesale CRM data."""
from database import SessionLocal, engine
import models
from datetime import datetime, timedelta
import random

models.Base.metadata.create_all(bind=engine)

db = SessionLocal()

# Clear existing data
db.query(models.OrderItem).delete()
db.query(models.Order).delete()
db.query(models.FollowUp).delete()
db.query(models.Contact).delete()
db.query(models.Account).delete()
db.commit()

now = datetime.utcnow()

accounts_data = [
    {"name": "Metro Grocery Chain", "account_type": "grocery", "status": "active", "phone": "555-0101", "email": "buying@metrogrocery.com", "city": "Chicago", "state": "IL", "territory": "Midwest", "payment_terms": "Net 30", "credit_limit": 50000},
    {"name": "Sunrise Distributors", "account_type": "distributor", "status": "active", "phone": "555-0102", "email": "orders@sunrisedist.com", "city": "Milwaukee", "state": "WI", "territory": "Midwest", "payment_terms": "Net 15", "credit_limit": 100000},
    {"name": "Harbor Fresh Market", "account_type": "grocery", "status": "active", "phone": "555-0103", "email": "procurement@harborfresh.com", "city": "Detroit", "state": "MI", "territory": "Midwest", "payment_terms": "Net 30", "credit_limit": 25000},
    {"name": "Coastal Restaurant Group", "account_type": "restaurant", "status": "active", "phone": "555-0104", "email": "chef@coastalrg.com", "city": "Miami", "state": "FL", "territory": "Southeast", "payment_terms": "Net 7", "credit_limit": 15000},
    {"name": "Apex Retail Partners", "account_type": "retailer", "status": "prospect", "phone": "555-0105", "email": "info@apexretail.com", "city": "Atlanta", "state": "GA", "territory": "Southeast", "payment_terms": None, "credit_limit": 0},
    {"name": "Pacific West Foods", "account_type": "distributor", "status": "active", "phone": "555-0106", "email": "sales@pacificwestfoods.com", "city": "Los Angeles", "state": "CA", "territory": "West", "payment_terms": "Net 30", "credit_limit": 75000},
    {"name": "Summit Specialty Stores", "account_type": "retailer", "status": "prospect", "phone": "555-0107", "email": "buyer@summitspecialty.com", "city": "Denver", "state": "CO", "territory": "Mountain", "payment_terms": None, "credit_limit": 0},
    {"name": "Rivertown Deli & Cafe", "account_type": "restaurant", "status": "on_hold", "phone": "555-0108", "email": "manager@rivertowndeli.com", "city": "Nashville", "state": "TN", "territory": "Southeast", "payment_terms": "Net 7", "credit_limit": 5000},
    {"name": "NorthStar Online Market", "account_type": "online", "status": "active", "phone": "555-0109", "email": "orders@northstaronline.com", "city": "Minneapolis", "state": "MN", "territory": "Midwest", "payment_terms": "Net 15", "credit_limit": 30000},
    {"name": "Blue Ridge Wholesalers", "account_type": "distributor", "status": "prospect", "phone": "555-0110", "email": "contact@blueridgewholesale.com", "city": "Charlotte", "state": "NC", "territory": "Southeast", "payment_terms": None, "credit_limit": 0},
]

accounts = []
for a in accounts_data:
    acc = models.Account(**a)
    db.add(acc)
    accounts.append(acc)
db.commit()
for acc in accounts:
    db.refresh(acc)

contacts_data = [
    (0, "Sarah", "Johnson", "Purchasing Manager", "555-1001", "sarah.j@metrogrocery.com", True),
    (0, "Mike", "Torres", "Assistant Buyer", "555-1002", "m.torres@metrogrocery.com", False),
    (1, "David", "Chen", "VP of Procurement", "555-1003", "d.chen@sunrisedist.com", True),
    (1, "Lisa", "Park", "Logistics Coordinator", "555-1004", "l.park@sunrisedist.com", False),
    (2, "Robert", "Williams", "Store Manager", "555-1005", "r.williams@harborfresh.com", True),
    (3, "Angela", "Martinez", "Executive Chef", "555-1006", "a.martinez@coastalrg.com", True),
    (3, "Tom", "Baker", "Food & Bev Director", "555-1007", "t.baker@coastalrg.com", False),
    (4, "Jennifer", "Smith", "Buying Director", "555-1008", "j.smith@apexretail.com", True),
    (5, "Kevin", "Nguyen", "Category Manager", "555-1009", "k.nguyen@pacificwestfoods.com", True),
    (6, "Patricia", "Lee", "Owner", "555-1010", "p.lee@summitspecialty.com", True),
    (7, "Carlos", "Rivera", "Manager", "555-1011", "c.rivera@rivertowndeli.com", True),
    (8, "Amanda", "White", "Procurement Lead", "555-1012", "a.white@northstaronline.com", True),
    (9, "James", "Brown", "CEO", "555-1013", "j.brown@blueridgewholesale.com", True),
]

contacts = []
for acc_idx, fn, ln, title, phone, email, primary in contacts_data:
    c = models.Contact(account_id=accounts[acc_idx].id, first_name=fn, last_name=ln, title=title, phone=phone, email=email, is_primary=primary)
    db.add(c)
    contacts.append((acc_idx, c))
db.commit()
for _, c in contacts:
    db.refresh(c)

types = ["call", "email", "meeting", "visit"]
priorities = ["low", "medium", "high"]

follow_ups_data = [
    (0, 0, "call", "pending", "high", "Quarterly pricing review", now - timedelta(days=2), None),
    (0, 0, "email", "completed", "medium", "Send updated product catalog", now - timedelta(days=5), now - timedelta(days=4)),
    (1, 2, "meeting", "pending", "high", "Contract renewal discussion", now + timedelta(days=1), None),
    (1, 2, "call", "pending", "medium", "Check on last shipment", now - timedelta(days=1), None),
    (2, 4, "call", "pending", "medium", "Follow up on new product samples", now + timedelta(days=2), None),
    (3, 5, "visit", "pending", "high", "Monthly in-person check-in", now + timedelta(days=3), None),
    (3, 5, "email", "completed", "low", "Send invoice for last order", now - timedelta(days=7), now - timedelta(days=6)),
    (4, 7, "call", "pending", "high", "Initial sales pitch follow-up", now, None),
    (4, 7, "meeting", "pending", "high", "Product demo and tasting", now + timedelta(days=5), None),
    (5, 8, "call", "pending", "medium", "Check inventory needs for Q2", now - timedelta(days=3), None),
    (6, 9, "email", "pending", "medium", "Send intro package and pricing sheet", now + timedelta(days=1), None),
    (6, 9, "call", "pending", "high", "Schedule discovery call", now, None),
    (7, 10, "call", "pending", "low", "Account review - on hold status", now + timedelta(days=7), None),
    (8, 11, "email", "completed", "medium", "Promo pricing for spring campaign", now - timedelta(days=3), now - timedelta(days=2)),
    (8, 11, "call", "pending", "medium", "Review spring order", now + timedelta(days=4), None),
    (9, 12, "call", "pending", "high", "Initial outreach - warm lead", now - timedelta(days=1), None),
    (9, 12, "meeting", "pending", "high", "Intro meeting + product walkthrough", now + timedelta(days=6), None),
    (0, 1, "call", "pending", "low", "Check on reorder for canned goods", now + timedelta(days=3), None),
]

for acc_idx, contact_entry_idx, ftype, fstatus, fpriority, subject, due, completed in follow_ups_data:
    acc_id = accounts[acc_idx].id
    contact_id = None
    for ci, (ai, c) in enumerate(contacts):
        if ai == acc_idx and ci == contact_entry_idx:
            contact_id = c.id
            break
    if contact_id is None:
        for ai, c in contacts:
            if ai == acc_idx:
                contact_id = c.id
                break
    fu = models.FollowUp(
        account_id=acc_id,
        contact_id=contact_id,
        follow_up_type=ftype,
        status=fstatus,
        priority=fpriority,
        subject=subject,
        due_date=due,
        completed_date=completed,
    )
    db.add(fu)
db.commit()

products = [
    ("Organic Olive Oil 1L", "OOO-001", "case", 24.99),
    ("Sea Salt Crackers 6-pk", "SSC-006", "case", 18.50),
    ("Premium Pasta Sauce 24oz", "PPS-024", "case", 32.00),
    ("Almond Butter 16oz", "AB-016", "case", 45.00),
    ("Sparkling Water 12pk", "SW-012", "pallet", 120.00),
    ("Organic Honey 12oz", "OH-012", "case", 55.00),
    ("Gluten-Free Flour 5lb", "GFF-005", "case", 28.00),
    ("Cold Brew Coffee Concentrate", "CBC-001", "case", 72.00),
]

orders_data = [
    (0, "ORD-2024-001", "delivered", now - timedelta(days=30), now - timedelta(days=25)),
    (0, "ORD-2024-008", "confirmed", now - timedelta(days=5), now + timedelta(days=2)),
    (1, "ORD-2024-002", "shipped", now - timedelta(days=10), now + timedelta(days=1)),
    (1, "ORD-2024-009", "pending", now - timedelta(days=2), None),
    (2, "ORD-2024-003", "delivered", now - timedelta(days=20), now - timedelta(days=15)),
    (3, "ORD-2024-004", "delivered", now - timedelta(days=14), now - timedelta(days=10)),
    (3, "ORD-2024-010", "pending", now - timedelta(days=1), None),
    (5, "ORD-2024-005", "confirmed", now - timedelta(days=3), now + timedelta(days=4)),
    (8, "ORD-2024-006", "shipped", now - timedelta(days=7), now + timedelta(days=2)),
    (8, "ORD-2024-011", "quote", now, None),
]

for acc_idx, order_num, status, odate, ship_date in orders_data:
    num_items = random.randint(2, 4)
    selected = random.sample(products, num_items)
    subtotal = 0
    order_items = []
    for pname, sku, unit, price in selected:
        qty = random.randint(2, 20)
        total = round(qty * price, 2)
        subtotal += total
        order_items.append(models.OrderItem(product_name=pname, sku=sku, quantity=qty, unit=unit, unit_price=price, total=total))
    discount = round(subtotal * 0.05, 2) if status in ("delivered", "confirmed") else 0
    order = models.Order(
        account_id=accounts[acc_idx].id,
        order_number=order_num,
        status=status,
        order_date=odate,
        ship_date=ship_date,
        subtotal=round(subtotal, 2),
        discount=discount,
        total=round(subtotal - discount, 2),
        items=order_items,
    )
    db.add(order)

db.commit()
print("Database seeded successfully!")
db.close()
