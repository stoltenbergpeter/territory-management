document.addEventListener('DOMContentLoaded',function(){
    function readJson(elementId, label) {
        try {
            return JSON.parse(document.getElementById(elementId).value);
        } catch (error) {
            window.alert(label + ' must contain valid JSON.');
            return null;
        }
    }
    
    document.getElementById("clickToDial").addEventListener("click", clickToDial);
    document.getElementById("addAssociation").addEventListener("click", addAssociation);
    document.getElementById("addAttribute").addEventListener("click", addAttribute);
    document.getElementById('addTransferContext').addEventListener("click", addTransferContext);
    document.getElementById('updateUserStatus').addEventListener("click", updateUserStatus);
    document.getElementById('pickupInteraction').addEventListener("click", updateInteractionState);
    document.getElementById('securePauseInteraction').addEventListener("click", updateInteractionState);
    document.getElementById('disconnectInteraction').addEventListener("click", updateInteractionState);
    document.getElementById('holdInteraction').addEventListener("click", updateInteractionState);
    document.getElementById('muteInteraction').addEventListener("click", updateInteractionState);
    document.getElementById('updateAudioConfiguration').addEventListener("click", updateAudioConfiguration);
    document.getElementById('sendCustomNotification').addEventListener("click", sendCustomNotification);
    
    document.getElementById('view-interactionList').addEventListener("click", setView);
    document.getElementById('view-calllog').addEventListener("click", setView);
    document.getElementById('view-newInteraction').addEventListener("click", setView);
    document.getElementById('view-callback').addEventListener("click", setView);
    document.getElementById('view-settings').addEventListener("click", setView);

    window.addEventListener("message", function(event) {
        var softphone = document.getElementById("softphone");
        if (!softphone || event.source !== softphone.contentWindow) {
            return;
        }

        var message;
        try {
            message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        } catch (error) {
            return;
        }

        if(message){
            if(message.type == "screenPop"){
                document.getElementById("screenPopPayload").value = event.data;
            } else if(message.type == "processCallLog"){
                document.getElementById("processCallLogPayLoad").value = event.data;
            } else if(message.type == "openCallLog"){
                document.getElementById("openCallLogPayLoad").value = event.data;
            } else if(message.type == "interactionSubscription"){
                document.getElementById("interactionSubscriptionPayload").value = event.data;
            } else if(message.type == "userActionSubscription"){
                document.getElementById("userActionSubscriptionPayload").value = event.data;
            } else if(message.type == "notificationSubscription"){
                document.getElementById("notificationSubscriptionPayload").value = event.data;
            } else if(message.type == "contactSearch") {
                document.getElementById("searchText").innerHTML = ": " + message.data.searchString;
                sendContactSearch();
            }
        }
    });

    function clickToDial() {
        console.log('process click to dial');
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'clickToDial',
            data: { number: '3172222222', autoPlace: true }
        }), "*");
    }

    function addAssociation() {
        console.log('process add association');
        var payload = readJson("associationPayload", "Association payload");
        if (!payload) return;
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'addAssociation',
            data: payload
        }), "*");
    }

    function addAttribute() {
        console.log('process add attribute');
        var payload = readJson("attributePayload", "Attribute payload");
        if (!payload) return;
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'addAttribute',
            data: payload
        }), "*");
    }

    function addTransferContext() {
        console.log('process add Transfer Context');
        var payload = readJson("transferContextPayload", "Transfer context payload");
        if (!payload) return;
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'addTransferContext',
            data: payload
        }), "*");
    }

    function sendContactSearch() {
        console.log('process add Search Context');
        var payload = readJson("contactSearchPayload", "Contact search payload");
        if (!payload) return;
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'sendContactSearch',
            data: payload
        }), "*");
    }

    function updateUserStatus() {
        console.log('process user status update');
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'updateUserStatus',
            data: { id:document.getElementById("statusDropDown").value }
        }), "*");
    }

    function updateInteractionState(event) {
        console.log('process interaction state change');
        var lastInteractionPayload = readJson("interactionSubscriptionPayload", "Interaction event payload");
        if (!lastInteractionPayload || !lastInteractionPayload.data || !lastInteractionPayload.data.interaction) {
            window.alert('Start or simulate a call before changing its state.');
            return;
        }
        var interactionId;
        if (lastInteractionPayload.data.interaction.old){
            interactionId = lastInteractionPayload.data.interaction.old.id;
        }else {
            interactionId = lastInteractionPayload.data.interaction.id;
        }
        let payload = {
            action: event.target.outerText,
            id: interactionId
        };
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'updateInteractionState',
            data: payload
        }), "*");
    }

    function updateAudioConfiguration(){
        console.log('Update Audio Configuration');
        var payload = {
            call: document.getElementById('audio-call').checked,
            chat: document.getElementById('audio-chat').checked,
            email: document.getElementById('audio-email').checked,
            callback: document.getElementById('audio-callback').checked,
            message: document.getElementById('audio-message').checked,
            voicemail: document.getElementById('audio-voicemail').checked
        }
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'updateAudioConfiguration',
            data: payload
        }), "*");
    }


    function setView(event) {
        console.log('process view update');
        let payload = {
            type:"main", 
            view: {
                name:event.target.outerText
            }
        };
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'setView',
            data: payload
        }), "*");
    }

    function sendCustomNotification(){
        console.log('Send Custom User Notification');
        var payload = {
            message: document.getElementById('customNotificationMessage').value,
            type: document.getElementById('notificationType').value,  
            timeout: document.getElementById('notificationTimeout').value
        };
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'sendCustomNotification',
            data: payload
        }), "*");
    }
})
