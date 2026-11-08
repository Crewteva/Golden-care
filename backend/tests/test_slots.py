from datetime import date, datetime, time, timedelta

import pytest

from app.core import clinic_time
from app.core.errors import AppError
from app.core.slots import DayPlanner

DAY = date(2030, 1, 5)


def at(h, m=0):
    return clinic_time.at(DAY, time(h, m))


def planner(busy=(), room_busy=None, room_type=None, fixed_room=1, fixed_type=10, reason=None):
    """A DayPlanner without a database: one 16:00–21:00 block in room 1 (type 10), plus room 2 (type 20)."""
    p = object.__new__(DayPlanner)
    p.reason = reason
    p.blocks = [] if reason else [{
        "branch_id": 1, "room_id": fixed_room, "room_active": True, "room_type_id": fixed_type,
        "room_name_ar": "عيادة ١", "room_name_en": "Clinic 1", "start": at(16), "end": at(21),
    }]
    p.doctor_busy = list(busy)
    p.rooms = [{"id": 1, "branch_id": 1, "room_type_id": 10, "name_ar": "", "name_en": "Clinic 1"},
               {"id": 2, "branch_id": 1, "room_type_id": 20, "name_ar": "", "name_en": "Laser room"}]
    p.room_busy = room_busy or {}
    p.room_type_id = room_type
    return p


def test_slots_fill_the_block_in_steps():
    slots = planner().slots(timedelta(minutes=30), timedelta(minutes=15))
    assert slots[0]["start"] == at(16) and slots[-1]["end"] == at(21)
    assert len(slots) == 19  # 16:00 … 20:30


def test_booked_time_is_not_offered():
    slots = planner(busy=[(at(17), at(17, 30))]).slots(timedelta(minutes=30), timedelta(minutes=15))
    starts = {s["start"] for s in slots}
    assert at(17) not in starts and at(16, 45) not in starts and at(17, 15) not in starts
    assert at(16, 30) in starts and at(17, 30) in starts


def test_service_needing_another_room_type_uses_a_free_room_of_that_type():
    p = planner(room_type=20)
    slots = p.slots(timedelta(minutes=30), timedelta(minutes=30))
    assert all(s["room_id"] == 2 for s in slots)
    busy = planner(room_type=20, room_busy={2: [(at(16), at(21))]})
    assert busy.slots(timedelta(minutes=30), timedelta(minutes=30)) == []


def test_check_explains_why_a_time_is_refused():
    p = planner(busy=[(at(18), at(18, 30))])
    with pytest.raises(AppError) as e:
        p.check(at(18, 15), at(18, 45))
    assert e.value.code == "slot_taken"
    with pytest.raises(AppError) as e:
        p.check(at(20, 45), at(21, 15))
    assert e.value.code == "outside_hours"
    with pytest.raises(AppError) as e:
        planner(room_busy={1: [(at(19), at(20))]}).check(at(19), at(19, 30))
    assert e.value.code == "room_taken"
    with pytest.raises(AppError) as e:
        planner(reason="leave").check(at(17), at(17, 30))
    assert e.value.code == "doctor_on_leave"
    block, room = planner().check(at(17), at(17, 30))
    assert room["id"] == 1


def test_past_times_are_skipped():
    slots = planner().slots(timedelta(minutes=30), timedelta(minutes=30), not_before=at(19))
    assert slots[0]["start"] == at(19)
