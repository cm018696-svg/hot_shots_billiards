/**
 * Estado global Hot Shots — 10 mesas + actividad del día (localStorage).
 * Misma fuente de datos para admin.html y reserva.html.
 */
(function (global) {
    var STORAGE_KEY = 'hotshots_club_state_v1';
    var TABLE_COUNT = 10;

    function todayYMD() {
        var d = new Date();
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    function defaultTables() {
        var arr = [];
        for (var i = 1; i <= TABLE_COUNT; i++) {
            arr.push({
                id: i,
                status: 'empty',
                clientName: null,
                endsAt: null,
                durationMinutes: null,
                startedAt: null
            });
        }
        return arr;
    }

    function load() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return { tables: defaultTables(), activity: [] };
            }
            var data = JSON.parse(raw);
            if (!data.tables || data.tables.length !== TABLE_COUNT) {
                return { tables: defaultTables(), activity: data.activity || [] };
            }
            return {
                tables: data.tables,
                activity: Array.isArray(data.activity) ? data.activity : []
            };
        } catch (e) {
            return { tables: defaultTables(), activity: [] };
        }
    }

    function save(state) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        try {
            global.dispatchEvent(new CustomEvent('hotshots-club-update'));
        } catch (err) {}
    }

    function uid() {
        if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    }

    function pushActivity(state, entry) {
        state.activity.unshift(entry);
        if (state.activity.length > 300) {
            state.activity = state.activity.slice(0, 300);
        }
    }

    /**
     * Actualiza mesas ocupadas cuyo tiempo ya venció → expired.
     */
    function tick() {
        var state = load();
        var now = Date.now();
        var changed = false;
        state.tables.forEach(function (t) {
            if (t.status === 'occupied' && t.endsAt && now >= t.endsAt) {
                t.status = 'expired';
                changed = true;
            }
        });
        if (changed) save(state);
        return state;
    }

    function startManualOccupation(tableId, clientName, durationMinutes) {
        var state = load();
        var t = state.tables[tableId - 1];
        if (!t || t.status !== 'empty') return { ok: false, reason: 'not_empty' };
        var now = Date.now();
        t.status = 'occupied';
        t.clientName = clientName;
        t.durationMinutes = durationMinutes;
        t.startedAt = now;
        t.endsAt = now + durationMinutes * 60 * 1000;
        pushActivity(state, {
            id: uid(),
            dayKey: todayYMD(),
            createdAt: now,
            type: 'manual_occupation',
            label: 'Manual session — Table ' + tableId + ' — ' + clientName + ' (' + durationMinutes + ' min)'
        });
        save(state);
        return { ok: true };
    }

    function releaseTable(tableId) {
        var state = load();
        var t = state.tables[tableId - 1];
        if (!t) return { ok: false };
        var now = Date.now();
        if (t.status === 'occupied' || t.status === 'expired') {
            pushActivity(state, {
                id: uid(),
                dayKey: todayYMD(),
                createdAt: now,
                type: 'manual_release',
                label: 'Table ' + tableId + ' released' + (t.clientName ? ' (' + t.clientName + ')' : '')
            });
        }
        t.status = 'empty';
        t.clientName = null;
        t.endsAt = null;
        t.durationMinutes = null;
        t.startedAt = null;
        save(state);
        return { ok: true };
    }

    /**
     * Reserva desde reserva.html — aparece en actividad del día según fecha de la reserva.
     */
    function addWebReservation(payload) {
        var state = load();
        var now = Date.now();
        var dayKey = payload.date || todayYMD();
        var tablePart = payload.tableId
            ? 'Table ' + payload.tableId
            : 'Any table';
        var label =
            'Web booking — ' +
            payload.name +
            ' — ' +
            tablePart +
            ' — ' +
            (payload.date || '') +
            ' ' +
            (payload.time || '');
        pushActivity(state, {
            id: uid(),
            dayKey: dayKey,
            createdAt: now,
            type: 'web_reservation',
            label: label,
            payload: payload
        });
        save(state);
        return { ok: true };
    }

    function activityForDay(dayKey) {
        var key = dayKey || todayYMD();
        var state = load();
        return state.activity.filter(function (a) {
            return a.dayKey === key;
        });
    }

    function getUpcomingReservations(daysAhead) {
        var state = load();
        var targetDays = daysAhead || 2;
        var today = new Date();
        var result = [];
        for (var d = 0; d <= targetDays; d++) {
            var checkDate = new Date(today);
            checkDate.setDate(checkDate.getDate() + d);
            var dayKey = checkDate.getFullYear() + '-' + 
                String(checkDate.getMonth() + 1).padStart(2, '0') + '-' + 
                String(checkDate.getDate()).padStart(2, '0');
            var dayReservations = state.activity.filter(function (a) {
                return a.dayKey === dayKey && a.type === 'web_reservation';
            });
            dayReservations.forEach(function (r) {
                r.displayDate = dayKey;
                result.push(r);
            });
        }
        return result.sort(function (a, b) {
            if (a.dayKey < b.dayKey) return -1;
            if (a.dayKey > b.dayKey) return 1;
            return 0;
        });
    }

    function remainingSeconds(table) {
        if (table.status !== 'occupied' || !table.endsAt) return null;
        var s = Math.floor((table.endsAt - Date.now()) / 1000);
        return Math.max(0, s);
    }

    function z2(n) {
        return n < 10 ? '0' + n : String(n);
    }

    function formatCountdown(totalSec) {
        if (totalSec == null || totalSec < 0) return '—';
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = totalSec % 60;
        if (h > 0) {
            return h + ':' + z2(m) + ':' + z2(s);
        }
        return z2(m) + ':' + z2(s);
    }

    global.HotShotsClub = {
        TABLE_COUNT: TABLE_COUNT,
        load: load,
        save: save,
        tick: tick,
        todayYMD: todayYMD,
        startManualOccupation: startManualOccupation,
        releaseTable: releaseTable,
        addWebReservation: addWebReservation,
        activityForDay: activityForDay,
        getUpcomingReservations: getUpcomingReservations,
        remainingSeconds: remainingSeconds,
        formatCountdown: formatCountdown
    };
})(typeof window !== 'undefined' ? window : this);
