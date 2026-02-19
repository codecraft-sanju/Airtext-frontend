import React, { useEffect, useState, useRef } from 'react';
import { 
  View, Text, TextInput, Button, StyleSheet, 
  PermissionsAndroid, ScrollView, Alert, ActivityIndicator, 
  TouchableOpacity, ToastAndroid, StatusBar, Platform, FlatList, RefreshControl 
} from 'react-native';
import io from 'socket.io-client';
import SmsAndroid from 'react-native-get-sms-android';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundService from 'react-native-background-actions';

const API_URL = 'https://airtext-fo6q.onrender.com';

// --- 📋 DEVELOPER CODE EXAMPLES ---
const CODE_EXAMPLES = {
    nodejs: `const axios = require('axios');

await axios.post('${API_URL}/send-sms', {
    apiKey: 'YOUR_API_KEY',
    phone: '+919876543210',
    msg: 'Hello from Node.js!'
});`,
    python: `import requests

url = "${API_URL}/send-sms"
data = {
    "apiKey": "YOUR_API_KEY",
    "phone": "+919876543210",
    "msg": "Hello from Python!"
}
requests.post(url, json=data)`,
    curl: `curl -X POST ${API_URL}/send-sms \\
-H "Content-Type: application/json" \\
-d '{"apiKey": "KEY", "phone": "NUMBER", "msg": "TEXT"}'`
};

// --- 🌙 BACKGROUND TASK LOGIC ---
const sleep = (time) => new Promise((resolve) => setTimeout(() => resolve(), time));

const backgroundTask = async (taskDataArguments) => {
    const { deviceId, apiUrl, userName } = taskDataArguments;
    console.log("🌙 Background Service Starting...");
    
    const socket = io(apiUrl, {
        auth: { deviceId: deviceId },
        transports: ['websocket', 'polling'], 
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
    });

    socket.on('connect', () => {
        console.log('🌙 Background: Connected ✅');
        BackgroundService.updateNotification({ 
            taskDesc: `Connected as ${userName} 🟢`,
            progressBar: { max: 10, value: 10, indeterminate: false }
        });
    });

    socket.on('disconnect', () => {
        console.log('🌙 Background: Disconnected ❌');
        BackgroundService.updateNotification({ taskDesc: 'Reconnecting... 🔴' });
    });

    socket.on('connect_error', (err) => {
        console.log("🌙 Background Socket Error:", err.message);
    });

    socket.on('send_sms_command', (data, callback) => {
        console.log(`🌙 SMS Request to: ${data.phone}`);
        try {
            SmsAndroid.autoSend(
                data.phone,
                data.msg,
                (fail) => {
                    console.log('🌙 SMS Failed:', fail);
                    if (callback) callback({ success: false, error: "SMS Fail" });
                },
                (success) => {
                    console.log('🌙 SMS Sent ✅');
                    if (callback) callback({ success: true, message: "Sent from Background" });
                }
            );
        } catch (error) {
            console.log('🌙 SMS Error:', error);
            if (callback) callback({ success: false, error: error.message });
        }
    });

    await new Promise(async (resolve) => {
        while (BackgroundService.isRunning()) {
            await sleep(5000); 
        }
        socket.disconnect();
        resolve();
    });
};

const options = {
    taskName: 'SMSGateway',
    taskTitle: 'SMS Gateway Active',
    taskDesc: 'Service is running in background',
    taskIcon: { name: 'ic_launcher', type: 'mipmap' },
    color: '#00ff00',
    linkingURI: 'yourSchemeHere://chat/jane',
    parameters: { delay: 1000 },
};

const App = () => {
  // --- 🚦 STATE MANAGEMENT ---
  const [currentView, setCurrentView] = useState('loading'); 
  const [userData, setUserData] = useState(null); 
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(''); 

  const [status, setStatus] = useState('Offline 🔴');
  const [logs, setLogs] = useState([]);
  const [isServiceRunning, setIsServiceRunning] = useState(false);
  const socketRef = useRef(null);

  // Tabs & History
  const [activeTab, setActiveTab] = useState('logs'); 
  const [smsHistory, setSmsHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Admin Data
  const [allUsers, setAllUsers] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  // Loaders
  const [isLoadingLogin, setIsLoadingLogin] = useState(false);
  const [isLoadingRegister, setIsLoadingRegister] = useState(false);
  const [isLoadingService, setIsLoadingService] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState(null); 

  // --- 🔄 APP STARTUP ---
  useEffect(() => {
    checkLoginStatus();
  }, []);

  const checkLoginStatus = async () => {
    try {
      const storedUser = await AsyncStorage.getItem('user_session');
      if (storedUser) {
        const user = JSON.parse(storedUser);
        setUserData(user);
        setCurrentView('home');
        
        if (user.role !== 'admin') {
            setIsServiceRunning(BackgroundService.isRunning());
            fetchHistory(user.apiKey); 
        } else {
            fetchUsersList();
        }
      } else {
        setCurrentView('login');
      }
    } catch (e) {
      setCurrentView('login');
    }
  };

  const fetchHistory = async (apiKeyOverride) => {
      const key = apiKeyOverride || userData?.apiKey;
      if(!key) return;
      setLoadingHistory(true);
      try {
          const response = await fetch(`${API_URL}/user/messages?apiKey=${key}`);
          const data = await response.json();
          if (data.success) {
              setSmsHistory(data.messages);
          }
      } catch (error) { console.error("Fetch Error", error); } 
      finally { setLoadingHistory(false); }
  };

  const fetchUsersList = async () => {
      setRefreshing(true);
      try {
          const response = await fetch(`${API_URL}/admin/users`);
          const data = await response.json();
          if (data.success) setAllUsers(data.users);
      } catch (error) { console.error(error); } 
      finally { setRefreshing(false); }
  };

  const deleteUser = async (id) => {
      Alert.alert("Delete User", "Are you sure?", [
          { text: "Cancel", style: "cancel" },
          { 
              text: "Delete", style: "destructive",
              onPress: async () => {
                  setDeletingUserId(id); 
                  try {
                      const response = await fetch(`${API_URL}/admin/user/${id}`, { method: 'DELETE' });
                      const data = await response.json();
                      if(data.success) {
                          ToastAndroid.show("User Deleted", ToastAndroid.SHORT);
                          fetchUsersList(); 
                      } else { Alert.alert("Error", data.message); }
                  } catch (err) { Alert.alert("Error", "Could not delete user"); } 
                  finally { setDeletingUserId(null); }
              }
          }
      ]);
  };

  const handleLogin = async () => {
    if (!email || !password) return Alert.alert("Error", "Please fill all fields");
    setIsLoadingLogin(true); 
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();

      if (data.success) {
        const userWithRole = { ...data.user, role: data.role || 'user' };
        await AsyncStorage.setItem('user_session', JSON.stringify(userWithRole));
        setUserData(userWithRole);
        setCurrentView('home');
        ToastAndroid.show(`Welcome ${userWithRole.name}!`, ToastAndroid.SHORT);
        
        if (data.role === 'admin') fetchUsersList();
        else fetchHistory(userWithRole.apiKey);
      } else { Alert.alert("Login Failed", data.message || "Invalid credentials"); }
    } catch (error) { Alert.alert("Connection Error", `Could not connect`); } 
    finally { setIsLoadingLogin(false); }
  };

  const handleRegister = async () => {
    if (!name || !email || !password) return Alert.alert("Error", "Please fill all fields");
    setIsLoadingRegister(true); 
    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });
      const data = await response.json();

      if (data.success || response.status === 201) {
        Alert.alert("Success", "Account created! Please Login.");
        setCurrentView('login');
      } else { Alert.alert("Registration Failed", data.message); }
    } catch (error) { Alert.alert("Error", "Connection Failed"); } 
    finally { setIsLoadingRegister(false); }
  };

  const handleLogout = async () => {
    if (BackgroundService.isRunning()) {
        await BackgroundService.stop();
        setIsServiceRunning(false);
    }
    if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
    }
    await AsyncStorage.removeItem('user_session');
    setUserData(null);
    setAllUsers([]); 
    setSmsHistory([]);
    setCurrentView('login');
    setStatus('Offline 🔴');
    setLogs([]);
  };

  const toggleService = async () => {
      setIsLoadingService(true); 
      try {
          if (isServiceRunning) {
              await BackgroundService.stop();
              setIsServiceRunning(false);
              addLog("🛑 Background Service Stopped");
              connectSocket();
          } else {
              await requestPermissions();
              if (socketRef.current) {
                  socketRef.current.disconnect();
                  socketRef.current = null;
              }
              await BackgroundService.start(backgroundTask, {
                  ...options,
                  parameters: {
                      deviceId: userData.deviceId,
                      apiUrl: API_URL, 
                      userName: userData.name
                  }
              });
              setIsServiceRunning(true);
              setStatus('Background Service Active 🚀');
              addLog("🚀 Background Service Started");
          }
      } catch (error) { Alert.alert("Error", "Failed to toggle service"); } 
      finally { setIsLoadingService(false); }
  };

  useEffect(() => {
    if (currentView === 'home' && userData && userData.role !== 'admin' && !isServiceRunning) {
      requestPermissions();
      connectSocket();
    }
    return () => { if (socketRef.current) socketRef.current.disconnect(); };
  }, [currentView, userData, isServiceRunning]);

  const addLog = (text) => setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${text}`, ...prev.slice(0, 50)]);

  const connectSocket = () => {
    if (isServiceRunning) return; 
    if (socketRef.current && socketRef.current.connected) return;

    addLog(`Connecting to Cloud...`);
    const newSocket = io(API_URL, {
      auth: { deviceId: userData.deviceId },
      transports: ['websocket', 'polling'], 
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    newSocket.on('connect', () => {
      setStatus(`Online: ${userData.name} 🟢`);
      addLog('✅ Connected to Secure Gateway');
    });

    newSocket.on('disconnect', (reason) => {
      setStatus('Offline 🔴');
      addLog(`❌ Disconnected: ${reason}`);
    });

    newSocket.on('connect_error', (err) => {
        setStatus('Connection Error ⚠️');
        addLog(`⚠️ Error: ${err.message}`);
    });

    newSocket.on('send_sms_command', (data, callback) => {
      addLog(`📩 Request: SMS to ${data.phone}`);
      try {
        SmsAndroid.autoSend(
          data.phone, data.msg,
          (fail) => {
            addLog(`🚫 Send Failed: ${fail}`);
            if (callback) callback({ success: false, error: "Fail" });
            fetchHistory(); 
          },
          (success) => {
            addLog(`✅ SMS Sent Successfully`);
            if (callback) callback({ success: true, message: "Sent" });
            fetchHistory(); 
          }
        );
      } catch (error) {
        addLog(`🚫 App Error: ${error}`);
        if (callback) callback({ success: false, error: error.message });
      }
    });

    socketRef.current = newSocket;
  };

  async function requestPermissions() {
    try {
      const permissions = [
        PermissionsAndroid.PERMISSIONS.SEND_SMS,
        PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
      ];
      if (Platform.Version >= 33) permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      await PermissionsAndroid.requestMultiple(permissions);
    } catch (err) { console.warn(err); }
  }

  // --- UI COMPONENTS ---
  const CodeBlock = ({ title, code }) => (
    <View style={styles.codeBlock}>
        <Text style={styles.codeTitle}>{title}</Text>
        <Text style={styles.codeText} selectable>{code}</Text>
    </View>
  );

  // --- RENDERING ---

  if (currentView === 'loading') {
    return (
      <View style={[styles.container, styles.center]}>
        <StatusBar barStyle="light-content" backgroundColor="#111" />
        <ActivityIndicator size="large" color="#00ff00" />
      </View>
    );
  }

  // 1. LOGIN UI
  if (currentView === 'login') {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#111" />
        <Text style={styles.header}>🔐 Gateway Login</Text>
        <View style={styles.card}>
          <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#666" onChangeText={setEmail} value={email} keyboardType="email-address"/>
          <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#666" secureTextEntry onChangeText={setPassword} value={password}/>
          
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: '#007AFF' }]} onPress={handleLogin} disabled={isLoadingLogin}>
            {isLoadingLogin ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnText}>Login</Text>}
          </TouchableOpacity>
          
          <TouchableOpacity onPress={() => setCurrentView('register')} style={styles.linkContainer}>
            <Text style={styles.linkText}>Create Account</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // 2. REGISTER UI
  if (currentView === 'register') {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#111" />
        <Text style={styles.header}>📝 Create Account</Text>
        <View style={styles.card}>
          <TextInput style={styles.input} placeholder="Device Name" placeholderTextColor="#666" onChangeText={setName} value={name}/>
          <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#666" onChangeText={setEmail} value={email} keyboardType="email-address"/>
          <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#666" secureTextEntry onChangeText={setPassword} value={password}/>
          
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: '#28a745' }]} onPress={handleRegister} disabled={isLoadingRegister}>
             {isLoadingRegister ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnText}>Register</Text>}
          </TouchableOpacity>
          
          <TouchableOpacity onPress={() => setCurrentView('login')} style={styles.linkContainer}>
            <Text style={styles.linkText}>Back to Login</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // 3. HOME SCREEN (ADMIN)
  if (currentView === 'home' && userData?.role === 'admin') {
      return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor="#111" />
            <View style={styles.topBar}>
                <Text style={styles.welcomeText}>👑 Admin Panel</Text>
                <Button title="Logout" onPress={handleLogout} color="#d9534f" />
            </View>
            <Text style={styles.infoLabel}>All Registered Devices</Text>
            <FlatList 
                data={allUsers}
                keyExtractor={(item) => item._id}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchUsersList} tintColor="#fff"/>}
                renderItem={({ item }) => (
                    <View style={styles.userCard}>
                        <View style={styles.userHeader}>
                            <Text style={styles.userName}>{item.name}</Text>
                            <View style={[styles.statusDot, { backgroundColor: item.isOnline ? '#00ff00' : '#555' }]} />
                        </View>
                        <Text style={styles.userEmail}>{item.email}</Text>
                        <Text style={styles.userDevice}>ID: {item.deviceId}</Text>
                        <Text style={styles.lastSeen}>Last Seen: {new Date(item.lastSeen).toLocaleString()}</Text>
                        <TouchableOpacity style={styles.deleteBtn} onPress={() => deleteUser(item._id)} disabled={deletingUserId === item._id}>
                            {deletingUserId === item._id ? <ActivityIndicator size="small" color="#ff4444" /> : <Text style={styles.deleteBtnText}>DELETE USER</Text>}
                        </TouchableOpacity>
                    </View>
                )}
                ListEmptyComponent={<Text style={styles.emptyLog}>No users found. Pull to refresh.</Text>}
            />
        </View>
      );
  }

  // --- 👤 NORMAL USER DASHBOARD UI ---
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#111" />
      <View style={styles.topBar}>
        <View>
            <Text style={styles.welcomeLabel}>Device Active</Text>
            <Text style={styles.welcomeText}>{userData?.name}</Text>
        </View>
        <Button title="Logout" onPress={handleLogout} color="#d9534f" />
      </View>

      <View style={styles.infoBox}>
        <View style={styles.row}>
            <Text style={styles.infoLabel}>ID:</Text>
            <Text style={styles.infoValue}>{userData?.deviceId}</Text>
        </View>
        <View style={styles.divider} />
        <Text style={styles.infoLabel}>API Key (Keep Secret):</Text>
        <Text style={styles.infoValue} selectable>{userData?.apiKey}</Text>
      </View>

      <TouchableOpacity 
        style={[styles.serviceBtn, { backgroundColor: isServiceRunning ? '#d9534f' : '#28a745' }]}
        onPress={toggleService} disabled={isLoadingService}>
        {isLoadingService ? <ActivityIndicator size="small" color="#fff" /> : 
        <Text style={styles.serviceBtnText}>{isServiceRunning ? "🛑 STOP SERVICE" : "🚀 START SERVICE"}</Text>}
      </TouchableOpacity>

      <Text style={[styles.status, { color: status.includes('Active') || status.includes('Online') ? '#00ff00' : '#ff4444' }]}>
        {status}
      </Text>

      {/* --- TABS SECTION --- */}
      <View style={styles.tabContainer}>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'logs' && styles.activeTabBtn]} onPress={() => setActiveTab('logs')}>
            <Text style={[styles.tabText, activeTab === 'logs' && styles.activeTabText]}>⚡ Logs</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'history' && styles.activeTabBtn]} onPress={() => { setActiveTab('history'); fetchHistory(); }}>
            <Text style={[styles.tabText, activeTab === 'history' && styles.activeTabText]}>📜 History</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'docs' && styles.activeTabBtn]} onPress={() => setActiveTab('docs')}>
            <Text style={[styles.tabText, activeTab === 'docs' && styles.activeTabText]}>👨‍💻 API Docs</Text>
        </TouchableOpacity>
      </View>

      {/* --- CONTENT SECTION --- */}
      <View style={styles.logsWrapper}>
        
        {/* TAB 1: LOGS */}
        {activeTab === 'logs' && (
            <ScrollView style={styles.logsContainer} nestedScrollEnabled={true}>
                {logs.length === 0 && <Text style={styles.emptyLog}>Waiting for commands...</Text>}
                {isServiceRunning && <Text style={styles.logText}>[Info] Logs hidden while running in background.</Text>}
                {logs.map((log, index) => <Text key={index} style={styles.logText}>{log}</Text>)}
                <View style={{height: 20}} />
            </ScrollView>
        )}

        {/* TAB 2: HISTORY */}
        {activeTab === 'history' && (
            <FlatList 
                data={smsHistory}
                keyExtractor={(item) => item._id}
                refreshControl={<RefreshControl refreshing={loadingHistory} onRefresh={fetchHistory} tintColor="#fff"/>}
                contentContainerStyle={{ padding: 10, paddingBottom: 20 }}
                renderItem={({ item }) => (
                    <View style={styles.historyCard}>
                        <View style={styles.historyHeader}>
                            <Text style={styles.historyPhone}>{item.phone}</Text>
                            <Text style={[
                                styles.historyStatus, 
                                { color: item.status === 'Sent' ? '#0f0' : item.status === 'Failed' ? '#f44' : '#fa0' }
                            ]}>{item.status}</Text>
                        </View>
                        <Text style={styles.historyMsg} numberOfLines={2}>{item.content}</Text>
                        <Text style={styles.historyDate}>{new Date(item.createdAt).toLocaleString()}</Text>
                        {item.errorMessage && <Text style={styles.historyError}>⚠️ {item.errorMessage}</Text>}
                    </View>
                )}
                ListEmptyComponent={<Text style={styles.emptyLog}>No messages found. Pull to refresh.</Text>}
            />
        )}

        {/* TAB 3: API DOCS */}
        {activeTab === 'docs' && (
            <ScrollView style={styles.logsContainer} contentContainerStyle={{ paddingBottom: 20 }}>
                <Text style={styles.docHeader}>How to integrate?</Text>
                <Text style={styles.docDesc}>Send POST requests to this endpoint:</Text>
                <Text style={styles.endpointUrl} selectable>{API_URL}/send-sms</Text>
                
                <CodeBlock title="Node.js (Axios)" code={CODE_EXAMPLES.nodejs} />
                <CodeBlock title="Python (Requests)" code={CODE_EXAMPLES.python} />
                <CodeBlock title="cURL" code={CODE_EXAMPLES.curl} />
                
                <Text style={styles.docNote}>⚠️ Keep your API Key secret!</Text>
            </ScrollView>
        )}
      </View>
    </View>
  );
};

// --- 🎨 STYLES ---
const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#0f0f0f' },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: { fontSize: 28, color: '#fff', fontWeight: 'bold', marginBottom: 30, textAlign: 'center', marginTop: 50 },
  card: { backgroundColor: '#1e1e1e', padding: 20, borderRadius: 12, elevation: 5 },
  input: { backgroundColor: '#333', color: '#fff', padding: 12, borderRadius: 8, marginBottom: 15, fontSize: 16, borderWidth: 1, borderColor: '#444' },
  linkContainer: { marginTop: 20, alignItems: 'center' },
  linkText: { color: '#007AFF', fontSize: 16 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, marginTop: 10 },
  welcomeLabel: { color: '#888', fontSize: 12 },
  welcomeText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  infoBox: { backgroundColor: '#1a1a1a', padding: 15, borderRadius: 12, marginBottom: 20, borderWidth: 1, borderColor: '#333' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  divider: { height: 1, backgroundColor: '#333', marginVertical: 10 },
  infoLabel: { color: '#aaa', fontSize: 12, marginBottom: 4 },
  infoValue: { color: '#00ff00', fontSize: 14, fontFamily: 'monospace', fontWeight: 'bold' },
  status: { fontSize: 16, textAlign: 'center', marginBottom: 15, fontWeight: 'bold', padding: 10, backgroundColor: '#222', borderRadius: 8 },
  
  // FIX: Logs Wrapper needs to take remaining space
  logsWrapper: { flex: 1, backgroundColor: '#000', borderRadius: 12, borderWidth: 1, borderColor: '#333', overflow: 'hidden' },
  logsContainer: { flex: 1, padding: 10 },
  logText: { color: '#0f0', fontFamily: 'monospace', fontSize: 12, marginBottom: 6 },
  emptyLog: { color: '#555', fontStyle: 'italic', textAlign: 'center', marginTop: 20 },
  
  primaryBtn: { padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  serviceBtn: { padding: 15, borderRadius: 10, alignItems: 'center', marginBottom: 20, elevation: 3 },
  serviceBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  
  // TABS STYLES (Fixed Height for Visibility)
  tabContainer: { flexDirection: 'row', marginBottom: 10, backgroundColor: '#1a1a1a', borderRadius: 8, padding: 4, height: 50 },
  tabBtn: { flex: 1, justifyContent: 'center', alignItems: 'center', borderRadius: 6 },
  activeTabBtn: { backgroundColor: '#333' },
  tabText: { color: '#666', fontWeight: 'bold', fontSize: 12 },
  activeTabText: { color: '#fff' },

  // HISTORY STYLES
  historyCard: { backgroundColor: '#111', borderBottomWidth: 1, borderBottomColor: '#333', padding: 12 },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  historyPhone: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  historyStatus: { fontSize: 12, fontWeight: 'bold' },
  historyMsg: { color: '#aaa', fontSize: 12, marginBottom: 4 },
  historyDate: { color: '#555', fontSize: 10 },
  historyError: { color: '#f44', fontSize: 10, marginTop: 2 },

  // DOCS STYLES
  docHeader: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 5 },
  docDesc: { color: '#aaa', fontSize: 14, marginBottom: 10 },
  endpointUrl: { color: '#0f0', backgroundColor: '#111', padding: 8, borderRadius: 5, fontFamily: 'monospace', marginBottom: 15, fontSize: 12 },
  docNote: { color: '#fa0', fontStyle: 'italic', marginTop: 10, textAlign: 'center' },
  codeBlock: { backgroundColor: '#111', padding: 10, borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: '#333' },
  codeTitle: { color: '#007AFF', fontWeight: 'bold', marginBottom: 5, fontSize: 12 },
  codeText: { color: '#ccc', fontFamily: 'monospace', fontSize: 10 },

  // ADMIN STYLES
  userCard: { backgroundColor: '#1e1e1e', padding: 15, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  userHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  userName: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  userEmail: { color: '#aaa', fontSize: 14, marginBottom: 5 },
  userDevice: { color: '#888', fontSize: 12, fontFamily: 'monospace' },
  lastSeen: { color: '#666', fontSize: 12, fontStyle: 'italic', marginTop: 5 },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  deleteBtn: { backgroundColor: '#330000', padding: 10, borderRadius: 5, marginTop: 10, alignItems: 'center', borderWidth: 1, borderColor: '#ff4444' },
  deleteBtnText: { color: '#ff4444', fontWeight: 'bold', fontSize: 12 }
});

export default App;