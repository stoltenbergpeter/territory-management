(function () {
    'use strict';

    var localOrigin = window.location.origin;
    var parentTargetOrigin = localOrigin === 'null' ? '*' : localOrigin;
    var interactionId = 'mock-interaction-4f6e90d1';
    var state = {
        interaction: {
            id: interactionId,
            state: 'idle',
            direction: 'inbound',
            number: ''
        },
        startedAt: null,
        view: 'interactionList',
        toastTimer: null
    };

    var elements = {
        agentStatus: document.getElementById('agentStatus'),
        audioIndicator: document.getElementById('audioIndicator'),
        callStatus: document.getElementById('callStatus'),
        callDetail: document.getElementById('callDetail'),
        callDirection: document.getElementById('callDirection'),
        callTimer: document.getElementById('callTimer'),
        currentView: document.getElementById('currentView'),
        contactResults: document.getElementById('contactResults'),
        searchSummary: document.getElementById('searchSummary'),
        activityLog: document.getElementById('activityLog'),
        toast: document.getElementById('toast')
    };

    function postToHost(type, data) {
        window.parent.postMessage(JSON.stringify({ type: type, data: data }), parentTargetOrigin);
    }

    function describeStatus(status) {
        var labels = {
            idle: 'No active call',
            alerting: 'Incoming call alerting',
            connected: 'Call connected',
            held: 'Call on hold',
            muted: 'Call muted',
            securePaused: 'Secure pause enabled',
            disconnected: 'Call disconnected'
        };
        return labels[status] || 'Interaction updated';
    }

    function interactionPayload() {
        return {
            id: state.interaction.id,
            state: state.interaction.state,
            direction: state.interaction.direction,
            ani: state.interaction.direction === 'inbound' ? state.interaction.number : undefined,
            dnis: state.interaction.direction === 'outbound' ? state.interaction.number : undefined,
            participants: [{
                id: 'mock-agent-jordan-doe',
                purpose: 'agent',
                state: state.interaction.state
            }]
        };
    }

    function publishInteraction(category) {
        postToHost('interactionSubscription', {
            category: category,
            interaction: interactionPayload()
        });
    }

    function publishUserAction(category, data) {
        postToHost('userActionSubscription', { category: category, data: data });
    }

    function publishNotification(category, data) {
        postToHost('notificationSubscription', { category: category, data: data });
    }

    function addActivity(message) {
        var item = document.createElement('li');
        var time = document.createElement('span');
        time.className = 'activity-time';
        time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '  ';
        item.appendChild(time);
        item.appendChild(document.createTextNode(message));
        elements.activityLog.insertBefore(item, elements.activityLog.firstChild);

        while (elements.activityLog.children.length > 7) {
            elements.activityLog.removeChild(elements.activityLog.lastChild);
        }
    }

    function showToast(message) {
        elements.toast.textContent = message;
        elements.toast.classList.add('visible');
        window.clearTimeout(state.toastTimer);
        state.toastTimer = window.setTimeout(function () {
            elements.toast.classList.remove('visible');
        }, 3200);
    }

    function updateTimer() {
        if (!state.startedAt) {
            elements.callTimer.textContent = '00:00';
            return;
        }

        var totalSeconds = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
        var minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
        var seconds = String(totalSeconds % 60).padStart(2, '0');
        elements.callTimer.textContent = minutes + ':' + seconds;
    }

    function updateCallPanel(detail) {
        elements.callStatus.textContent = describeStatus(state.interaction.state);
        elements.callDetail.textContent = detail || (state.interaction.number ? state.interaction.number : 'Use a control below or Click-to-Dial in the host page.');
        elements.callDirection.textContent = state.interaction.direction === 'outbound' ? 'Outbound' : 'Inbound';
        updateTimer();
    }

    function setInteractionState(nextState, detail, category) {
        state.interaction.state = nextState;
        updateCallPanel(detail);
        publishInteraction(category || 'change');
        publishNotification('interactionStateChanged', {
            interactionId: state.interaction.id,
            state: nextState
        });
    }

    function startCall(number, direction, stateName) {
        state.interaction.number = number;
        state.interaction.direction = direction;
        state.interaction.state = stateName;
        state.startedAt = Date.now();
        updateCallPanel(number);
        publishInteraction('change');
        postToHost('screenPop', {
            searchString: number,
            interactionId: state.interaction.id
        });
        publishUserAction(direction === 'outbound' ? 'clickToDial' : 'inboundAlert', {
            number: number,
            interactionId: state.interaction.id
        });
    }

    function renderSearchResults(results) {
        elements.contactResults.replaceChildren();
        if (!Array.isArray(results) || results.length === 0) {
            var empty = document.createElement('li');
            empty.className = 'empty';
            empty.textContent = 'The host returned no matching contacts.';
            elements.contactResults.appendChild(empty);
            return;
        }

        results.forEach(function (contact) {
            var result = document.createElement('li');
            var name = document.createElement('span');
            name.className = 'result-name';
            name.textContent = contact.name || 'Unnamed contact';
            var phones = Array.isArray(contact.phone) ? contact.phone.map(function (phone) {
                return phone.label ? phone.label + ': ' + phone.number : phone.number;
            }).filter(Boolean).join(' · ') : '';
            result.appendChild(name);
            result.appendChild(document.createTextNode(phones || contact.type || 'External contact'));
            elements.contactResults.appendChild(result);
        });
    }

    function handleInteractionState(data) {
        var action = String(data.action || '').toLowerCase();
        var mappings = {
            pickup: 'connected',
            disconnect: 'disconnected',
            hold: 'held',
            mute: 'muted',
            securepause: 'securePaused'
        };
        var nextState = mappings[action] || state.interaction.state;
        setInteractionState(nextState, state.interaction.number || 'Mock interaction', 'change');
        addActivity('Host changed interaction state to ' + (action || nextState) + '.');
        showToast('Interaction state: ' + describeStatus(nextState));
    }

    function handleMessage(message) {
        var data = message.data || {};

        switch (message.type) {
        case 'clickToDial':
            var number = data.number || '3172222222';
            startCall(number, 'outbound', 'connected');
            addActivity('Host requested Click-to-Dial for ' + number + '.');
            showToast('Mock call placed to ' + number + '.');
            break;
        case 'addAssociation':
            addActivity('Association received: ' + (data.text || data.id || 'mock data') + '.');
            publishUserAction('addAssociation', data);
            showToast('Association saved in the mock client.');
            break;
        case 'addAttribute':
            addActivity('Custom attributes received for an interaction.');
            publishNotification('customAttributesUpdated', data);
            showToast('Custom attributes recorded.');
            break;
        case 'addTransferContext':
            addActivity('Transfer context received: ' + (data.name || 'mock context') + '.');
            publishUserAction('addTransferContext', data);
            showToast('Transfer context recorded.');
            break;
        case 'sendContactSearch':
            renderSearchResults(data);
            addActivity('Host returned ' + (Array.isArray(data) ? data.length : 0) + ' contact result(s).');
            showToast('Contact search results received.');
            break;
        case 'updateUserStatus':
            var status = String(data.id || 'AVAILABLE').replace(/_/g, ' ').toLowerCase();
            elements.agentStatus.textContent = status.replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
            addActivity('Agent status changed to ' + elements.agentStatus.textContent + '.');
            publishNotification('userStatusChanged', data);
            showToast('Agent status updated.');
            break;
        case 'updateInteractionState':
            handleInteractionState(data);
            break;
        case 'setView':
            state.view = data.view && data.view.name ? data.view.name : 'interactionList';
            elements.currentView.textContent = state.view;
            addActivity('Host opened the ' + state.view + ' view.');
            publishUserAction('setView', data);
            break;
        case 'updateAudioConfiguration':
            var enabledTypes = Object.keys(data).filter(function (key) { return data[key]; });
            elements.audioIndicator.style.opacity = enabledTypes.length ? '1' : '.35';
            addActivity('Audio configured for ' + (enabledTypes.join(', ') || 'no interaction types') + '.');
            showToast('Audio configuration saved.');
            break;
        case 'sendCustomNotification':
            addActivity('Host sent a ' + String(data.type || 'INFO').toLowerCase() + ' notification.');
            showToast(data.message || 'Mock notification');
            publishNotification('customNotification', data);
            break;
        default:
            addActivity('Received unsupported message type: ' + message.type + '.');
        }
    }

    window.addEventListener('message', function (event) {
        if (event.source !== window.parent || (parentTargetOrigin !== '*' && event.origin !== localOrigin)) {
            return;
        }

        var message;
        try {
            message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        } catch (error) {
            return;
        }

        if (!message || typeof message.type !== 'string') {
            return;
        }

        handleMessage(message);
    });

    document.getElementById('simulateInbound').addEventListener('click', function () {
        startCall('+1 317-555-0198', 'inbound', 'alerting');
        addActivity('Simulated an inbound call and raised screenPop.');
        showToast('Inbound call is alerting. Use Pickup in the host to connect it.');
    });

    document.getElementById('requestSearch').addEventListener('click', function () {
        var searchString = 'Weather Line';
        elements.searchSummary.textContent = 'Searching “' + searchString + '”';
        postToHost('contactSearch', { searchString: searchString });
        addActivity('Requested host contact search for “' + searchString + '”.');
    });

    document.getElementById('openCallLog').addEventListener('click', function () {
        var callLog = {
            id: 'mock-log-' + Date.now(),
            subject: 'Local mock call',
            notes: 'Created from the local mock client.'
        };
        postToHost('openCallLog', { callLog: callLog, interaction: state.interaction.id });
        postToHost('processCallLog', {
            callLog: callLog,
            interactionId: state.interaction.id,
            eventName: 'mock.openCallLog'
        });
        addActivity('Raised openCallLog and processCallLog events.');
        showToast('Call-log events sent to the host.');
    });

    document.getElementById('clearActivity').addEventListener('click', function () {
        elements.activityLog.replaceChildren();
    });

    addActivity('Local mock client connected.');
    updateCallPanel();
    window.setInterval(updateTimer, 1000);
    window.setTimeout(function () {
        publishInteraction('snapshot');
        publishNotification('mockReady', { interactionId: state.interaction.id });
    }, 500);
}());
