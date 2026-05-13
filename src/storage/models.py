from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, Date, DateTime, Numeric,
    UniqueConstraint, Index, create_engine
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class DbProcessedEmail(Base):
    """Represents a processed email record in the database."""

    __tablename__ = "processed_emails"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email_id = Column(String, unique=True, nullable=False)
    subject = Column(String)
    processed_at = Column(DateTime, default=datetime.utcnow)
    attachments_count = Column(Integer, default=0)
    reports_count = Column(Integer, default=0)
    entries_count = Column(Integer, default=0)
    status = Column(String)
    error_message = Column(String)


class DbDailyEntry(Base):
    """Represents a daily kilometrage entry in the database."""

    __tablename__ = "daily_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    vehicle_name = Column(String, nullable=False)
    vehicle_plate = Column(String)
    entry_date = Column(Date, nullable=False)
    kilometers = Column(Float)
    speed_excess = Column(Integer)
    parking_time = Column(Integer)
    fuel = Column(Float)
    source_file = Column(String)
    email_id = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("vehicle_name", "entry_date", "kilometers",
                         name="uq_vehicle_date_km"),
        Index("idx_entries_date", "entry_date"),
        Index("idx_entries_vehicle", "vehicle_name"),
    )


class IncomeExpense(Base):
    """Represents an income/expense record for a vehicle in the database."""

    __tablename__ = "income_expenses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    vehicle_name = Column(String, nullable=False)
    entry_date = Column(Date, nullable=False)
    kilometers = Column(Float)
    is_rented = Column(Boolean)
    customer_name = Column(String)
    days = Column(Integer)
    notes = Column(String)
    rate_per_day = Column(Numeric(12, 2))
    income = Column(Numeric(12, 2))
    total_income = Column(Numeric(12, 2))
    expenses = Column(Numeric(12, 2))
    cash_balance = Column(Numeric(12, 2))
    location_link = Column(String)
    source_file = Column(String)
    email_id = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("vehicle_name", "entry_date", name="uq_income_vehicle_date"),
        Index("idx_income_date", "entry_date"),
        Index("idx_income_vehicle", "vehicle_name"),
    )
