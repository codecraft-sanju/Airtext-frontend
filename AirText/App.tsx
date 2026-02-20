import React, { useEffect, useState, useRef } from 'react';
import { 
    View, Text, TextInput, Button, StyleSheet, 
    PermissionsAndroid, ScrollView, Alert, ActivityIndicator, 
    TouchableOpacity, ToastAndroid, StatusBar, Platform, FlatList, RefreshControl, Animated
} from 'react-native';
import io from 'socket.io-client';
import SmsAndroid from 'react-native-get-sms-android';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundService from 'react-native-background-actions';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const API_URL = 'https://airtext-fo6q.onrender.com';

// --- 📋 DEVELOPER CODE EXAMPLES ---
const CODE_EXAMPLES = {
    nodejs: `const axios = require('axios');

await axios.post('${API_URL}/send-sms', {
    apiKey: 'YOUR_API_KEY',
    phone: '+919876543210',
    msg: 'Hello from Node.js!',
    webhookUrl: 'https://your-site.com/webhook'
});`,
    python: `import requests

url = "${API_URL}/send-sms"
data = {
    "apiKey": "YOUR_API_KEY",
    "phone": "+919876543210",
    "msg": "Hello from Python!",
    "webhookUrl": "https://your-site.com/webhook"
}
requests.post(url, json=data)`,
    curl: `curl -X POST ${API_URL}/send-sms \\
-H "Content-Type: application/json" \\
-d '{"apiKey": "KEY", "phone": "NUMBER", "msg": "TEXT", "webhookUrl": "https://your-site.com/webhook"}'`
};

// --- 🌙 BACKGROUND TASK LOGIC ---
const sleep = (time) => new Promise((resolve) => setTimeout(() => resolve(), time));

const backgroundTask = async (taskDataArguments) => {
    const { deviceId, apiUrl, userName } = taskDataArguments;
    console.log("Background Service Starting...");
    
    const socket = io(apiUrl, {
        auth: { deviceId: deviceId },
        transports: ['websocket', 'polling'], 
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
    });

    socket.on('connect', () => {
        console.log('Background: Connected');
        BackgroundService.updateNotification({ 
            taskDesc: `Connected as ${userName} [Online]`,
            progressBar: { max: 10, value: 10, indeterminate: false }
        });
    });

    socket.on('disconnect', () => {
        console.log('Background: Disconnected');
        BackgroundService.updateNotification({ taskDesc: 'Reconnecting... [Offline]' });
    });

    socket.on('connect_error', (err) => {
        console.log("Background Socket Error:", err.message);
    });

    socket.on('send_sms_command', async (data, callback) => {
        console.log(`SMS Request to: ${data.phone}`);
        try {
            SmsAndroid.autoSend(
                data.phone,
                data.msg,
                (fail) => {
                    console.log('SMS Failed:', fail);
                    if (callback) callback({ success: false, error: "SMS Fail" });
                },
                (success) => {
                    console.log('SMS Sent');
                    if (callback) callback({ success: true, message: "Sent from Background" });
                }
            );

            // Background Notification Cooldown Timer
            for(let i = 20; i > 0; i--) {
                if (!BackgroundService.isRunning()) break;
                await BackgroundService.updateNotification({ taskDesc: `Cooldown: ${i}s wait...` });
                await sleep(1000);
            }
            
            if (BackgroundService.isRunning()) {
                await BackgroundService.updateNotification({ taskDesc: `Connected as ${userName} [Online]` });
            }

        } catch (error) {
            console.log('SMS Error:', error);
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
    color: '#007AFF',
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

  const [status, setStatus] = useState('Offline');
  const [cooldown, setCooldown] = useState(0); // ⏳ New Cooldown State
  const [logs, setLogs] = useState([]);
  const [isServiceRunning, setIsServiceRunning] = useState(false);
  const socketRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

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

  useEffect(() => {
      Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
      }).start();
  }, [currentView]);

  // --- ⏳ COOLDOWN TIMER EFFECT ---
  useEffect(() => {
      let timer;
      if (cooldown > 0) {
          timer = setInterval(() => {
              setCooldown(prev => prev - 1);
          }, 1000);
      }
      return () => clearInterval(timer);
  }, [cooldown]);

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
        fadeAnim.setValue(0);
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
        fadeAnim.setValue(0);
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
    setCooldown(0);
    fadeAnim.setValue(0);
    setCurrentView('login');
    setStatus('Offline');
    setLogs([]);
  };

  const toggleService = async () => {
      setIsLoadingService(true); 
      try {
          if (isServiceRunning) {
              await BackgroundService.stop();
              setIsServiceRunning(false);
              addLog("Background Service Stopped");
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
              setStatus('Background Service Active');
              addLog("Background Service Started");
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
      setStatus(`Online: ${userData.name}`);
      addLog('Connected to Secure Gateway');
    });

    newSocket.on('disconnect', (reason) => {
      setStatus('Offline');
      addLog(`Disconnected: ${reason}`);
    });

    newSocket.on('connect_error', (err) => {
        setStatus('Connection Error');
        addLog(`Error: ${err.message}`);
    });

    newSocket.on('send_sms_command', (data, callback) => {
      addLog(`Request: SMS to ${data.phone}`);
      setCooldown(20); // ⏳ Start 20s cooldown on UI
      try {
        SmsAndroid.autoSend(
          data.phone, data.msg,
          (fail) => {
            addLog(`Send Failed: ${fail}`);
            if (callback) callback({ success: false, error: "Fail" });
            fetchHistory(); 
          },
          (success) => {
            addLog(`SMS Sent Successfully`);
            if (callback) callback({ success: true, message: "Sent" });
            setTimeout(() => {
                fetchHistory(); 
            }, 1000); 
          }
        );
      } catch (error) {
        addLog(`App Error: ${error}`);
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
        <StatusBar barStyle="light-content" backgroundColor="#09090B" />
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  // 1. LOGIN UI
  if (currentView === 'login') {
    return (
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        <StatusBar barStyle="light-content" backgroundColor="#09090B" />
        <View style={styles.headerContainer}>
            <Icon name="shield-lock-outline" size={40} color="#007AFF" />
            <Text style={styles.header}>Gateway Login</Text>
        </View>
        <View style={styles.card}>
          <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#666" onChangeText={setEmail} value={email} keyboardType="email-address"/>
          <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#666" secureTextEntry onChangeText={setPassword} value={password}/>
          
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: '#007AFF' }]} onPress={handleLogin} disabled={isLoadingLogin}>
            {isLoadingLogin ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnText}>Login</Text>}
          </TouchableOpacity>
          
          <TouchableOpacity onPress={() => { fadeAnim.setValue(0); setCurrentView('register'); }} style={styles.linkContainer}>
            <Text style={styles.linkText}>Create Account</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  }

  // 2. REGISTER UI
  if (currentView === 'register') {
    return (
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        <StatusBar barStyle="light-content" backgroundColor="#09090B" />
        <View style={styles.headerContainer}>
            <Icon name="account-plus-outline" size={40} color="#007AFF" />
            <Text style={styles.header}>Create Account</Text>
        </View>
        <View style={styles.card}>
          <TextInput style={styles.input} placeholder="Device Name" placeholderTextColor="#666" onChangeText={setName} value={name}/>
          <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#666" onChangeText={setEmail} value={email} keyboardType="email-address"/>
          <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#666" secureTextEntry onChangeText={setPassword} value={password}/>
          
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: '#007AFF' }]} onPress={handleRegister} disabled={isLoadingRegister}>
             {isLoadingRegister ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnText}>Register</Text>}
          </TouchableOpacity>
          
          <TouchableOpacity onPress={() => { fadeAnim.setValue(0); setCurrentView('login'); }} style={styles.linkContainer}>
            <Text style={styles.linkText}>Back to Login</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  }

  // 3. HOME SCREEN (ADMIN)
  if (currentView === 'home' && userData?.role === 'admin') {
      return (
        <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
            <StatusBar barStyle="light-content" backgroundColor="#09090B" />
            <View style={styles.topBar}>
                <View style={styles.row}>
                    <Icon name="shield-crown-outline" size={24} color="#ffd700" style={{ marginRight: 8 }} />
                    <Text style={styles.welcomeText}>Admin Panel</Text>
                </View>
                <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
                    <Icon name="logout" size={20} color="#ff4444" />
                </TouchableOpacity>
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
                            {deletingUserId === item._id ? <ActivityIndicator size="small" color="#ff4444" /> : (
                                <View style={styles.row}>
                                    <Icon name="trash-can-outline" size={16} color="#ff4444" style={{ marginRight: 6 }} />
                                    <Text style={styles.deleteBtnText}>DELETE USER</Text>
                                </View>
                            )}
                        </TouchableOpacity>
                    </View>
                )}
                ListEmptyComponent={<Text style={styles.emptyLog}>No users found. Pull to refresh.</Text>}
            />
        </Animated.View>
      );
  }

  // --- 👤 NORMAL USER DASHBOARD UI ---
  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />
      <View style={styles.topBar}>
        <View>
            <Text style={styles.welcomeLabel}>Device Active</Text>
            <Text style={styles.welcomeText}>{userData?.name}</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <Icon name="logout" size={20} color="#ff4444" />
        </TouchableOpacity>
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
        style={[styles.serviceBtn, { backgroundColor: isServiceRunning ? '#27272A' : '#007AFF' }]}
        onPress={toggleService} disabled={isLoadingService}>
        {isLoadingService ? <ActivityIndicator size="small" color="#fff" /> : 
        <View style={styles.row}>
            <Icon name={isServiceRunning ? "stop-circle-outline" : "rocket-launch-outline"} size={22} color={isServiceRunning ? "#ff4444" : "#fff"} style={{ marginRight: 8 }} />
            <Text style={[styles.serviceBtnText, isServiceRunning && { color: '#ff4444' }]}>{isServiceRunning ? "STOP SERVICE" : "START SERVICE"}</Text>
        </View>
        }
      </TouchableOpacity>

      <View style={styles.statusContainer}>
          {cooldown > 0 ? (
              <>
                  <Icon name="timer-sand" size={20} color="#fa0" style={{ marginRight: 8 }} />
                  <Text style={[styles.status, { color: '#fa0' }]}>
                      Cooldown: {cooldown}s...
                  </Text>
              </>
          ) : (
              <>
                  <Icon name={status.includes('Active') || status.includes('Online') ? "check-circle-outline" : "close-circle-outline"} size={20} color={status.includes('Active') || status.includes('Online') ? '#00ff00' : '#ff4444'} style={{ marginRight: 8 }} />
                  <Text style={[styles.status, { color: status.includes('Active') || status.includes('Online') ? '#00ff00' : '#ff4444' }]}>
                    {status}
                  </Text>
              </>
          )}
      </View>

      {/* --- TABS SECTION --- */}
      <View style={styles.tabContainer}>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'logs' && styles.activeTabBtn]} onPress={() => setActiveTab('logs')}>
            <Icon name="console" size={18} color={activeTab === 'logs' ? '#fff' : '#666'} style={{ marginBottom: 4 }} />
            <Text style={[styles.tabText, activeTab === 'logs' && styles.activeTabText]}>Logs</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'history' && styles.activeTabBtn]} onPress={() => { setActiveTab('history'); fetchHistory(); }}>
            <Icon name="history" size={18} color={activeTab === 'history' ? '#fff' : '#666'} style={{ marginBottom: 4 }} />
            <Text style={[styles.tabText, activeTab === 'history' && styles.activeTabText]}>History</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'docs' && styles.activeTabBtn]} onPress={() => setActiveTab('docs')}>
            <Icon name="api" size={18} color={activeTab === 'docs' ? '#fff' : '#666'} style={{ marginBottom: 4 }} />
            <Text style={[styles.tabText, activeTab === 'docs' && styles.activeTabText]}>Docs</Text>
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
                            <View style={styles.row}>
                                <Icon name={item.status === 'Sent' ? "check-circle" : item.status === 'Failed' ? "close-circle" : "clock-outline"} size={14} color={item.status === 'Sent' ? '#0f0' : item.status === 'Failed' ? '#f44' : '#fa0'} style={{ marginRight: 4 }} />
                                <Text style={[
                                    styles.historyStatus, 
                                    { color: item.status === 'Sent' ? '#0f0' : item.status === 'Failed' ? '#f44' : '#fa0' }
                                ]}>{item.status}</Text>
                            </View>
                        </View>
                        <Text style={styles.historyMsg} numberOfLines={2}>{item.content}</Text>
                        <Text style={styles.historyDate}>{new Date(item.createdAt).toLocaleString()}</Text>
                        {item.errorMessage && (
                            <View style={[styles.row, { marginTop: 4 }]}>
                                <Icon name="alert-circle-outline" size={12} color="#f44" style={{ marginRight: 4 }} />
                                <Text style={styles.historyError}>{item.errorMessage}</Text>
                            </View>
                        )}
                    </View>
                )}
                ListEmptyComponent={<Text style={styles.emptyLog}>No messages found. Pull to refresh.</Text>}
            />
        )}

        {/* TAB 3: API DOCS */}
        {activeTab === 'docs' && (
            <ScrollView style={styles.logsContainer} contentContainerStyle={{ paddingBottom: 20 }}>
                <Text style={styles.docHeader}>Integration Guide</Text>
                <Text style={styles.docDesc}>Send POST requests to this endpoint:</Text>
                <View style={styles.endpointContainer}>
                    <Icon name="link-variant" size={16} color="#007AFF" style={{ marginRight: 8 }} />
                    <Text style={styles.endpointUrl} selectable>{API_URL}/send-sms</Text>
                </View>
                
                <CodeBlock title="Node.js (Axios)" code={CODE_EXAMPLES.nodejs} />
                <CodeBlock title="Python (Requests)" code={CODE_EXAMPLES.python} />
                <CodeBlock title="cURL" code={CODE_EXAMPLES.curl} />
                
                <View style={styles.docNoteContainer}>
                    <Icon name="shield-alert-outline" size={18} color="#fa0" style={{ marginRight: 6 }} />
                    <Text style={styles.docNote}>Keep your API Key secret!</Text>
                </View>
            </ScrollView>
        )}
      </View>
    </Animated.View>
  );
};

// --- 🎨 STYLES ---
const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#09090B' },
  center: { justifyContent: 'center', alignItems: 'center' },
  headerContainer: { alignItems: 'center', marginBottom: 30, marginTop: 50 },
  header: { fontSize: 26, color: '#fff', fontWeight: 'bold', marginTop: 10 },
  card: { backgroundColor: '#18181B', padding: 24, borderRadius: 16, elevation: 5, borderWidth: 1, borderColor: '#27272A' },
  input: { backgroundColor: '#09090B', color: '#fff', padding: 16, borderRadius: 12, marginBottom: 16, fontSize: 16, borderWidth: 1, borderColor: '#27272A' },
  linkContainer: { marginTop: 24, alignItems: 'center' },
  linkText: { color: '#007AFF', fontSize: 16, fontWeight: '500' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, marginTop: 10 },
  welcomeLabel: { color: '#A1A1AA', fontSize: 12, marginBottom: 2 },
  welcomeText: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  logoutBtn: { backgroundColor: '#27272A', padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#3F3F46' },
  infoBox: { backgroundColor: '#18181B', padding: 18, borderRadius: 16, marginBottom: 20, borderWidth: 1, borderColor: '#27272A' },
  row: { flexDirection: 'row', alignItems: 'center' },
  divider: { height: 1, backgroundColor: '#27272A', marginVertical: 12 },
  infoLabel: { color: '#A1A1AA', fontSize: 12, marginBottom: 4 },
  infoValue: { color: '#007AFF', fontSize: 14, fontFamily: 'monospace', fontWeight: 'bold' },
  statusContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 20, padding: 12, backgroundColor: '#18181B', borderRadius: 12, borderWidth: 1, borderColor: '#27272A' },
  status: { fontSize: 16, fontWeight: 'bold' },
  
  // FIX: Logs Wrapper needs to take remaining space
  logsWrapper: { flex: 1, backgroundColor: '#18181B', borderRadius: 16, borderWidth: 1, borderColor: '#27272A', overflow: 'hidden' },
  logsContainer: { flex: 1, padding: 16 },
  logText: { color: '#A1A1AA', fontFamily: 'monospace', fontSize: 12, marginBottom: 8, lineHeight: 18 },
  emptyLog: { color: '#71717A', fontStyle: 'italic', textAlign: 'center', marginTop: 24 },
  
  primaryBtn: { padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 10, elevation: 2 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  serviceBtn: { padding: 18, borderRadius: 16, alignItems: 'center', marginBottom: 16, elevation: 3 },
  serviceBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16, letterSpacing: 0.5 },
  
  // TABS STYLES
  tabContainer: { flexDirection: 'row', marginBottom: 16, backgroundColor: '#18181B', borderRadius: 12, padding: 6, borderWidth: 1, borderColor: '#27272A' },
  tabBtn: { flex: 1, justifyContent: 'center', alignItems: 'center', borderRadius: 8, paddingVertical: 10 },
  activeTabBtn: { backgroundColor: '#27272A' },
  tabText: { color: '#71717A', fontWeight: '600', fontSize: 12 },
  activeTabText: { color: '#fff' },

  // HISTORY STYLES
  historyCard: { backgroundColor: '#09090B', borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#27272A' },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  historyPhone: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  historyStatus: { fontSize: 12, fontWeight: 'bold' },
  historyMsg: { color: '#A1A1AA', fontSize: 13, marginBottom: 8, lineHeight: 18 },
  historyDate: { color: '#71717A', fontSize: 11 },
  historyError: { color: '#f44', fontSize: 11 },

  // DOCS STYLES
  docHeader: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 6 },
  docDesc: { color: '#A1A1AA', fontSize: 14, marginBottom: 16 },
  endpointContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#09090B', padding: 12, borderRadius: 10, marginBottom: 20, borderWidth: 1, borderColor: '#27272A' },
  endpointUrl: { color: '#007AFF', fontFamily: 'monospace', fontSize: 13 },
  docNoteContainer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 16, padding: 12, backgroundColor: '#27272A', borderRadius: 10 },
  docNote: { color: '#fa0', fontWeight: '500' },
  codeBlock: { backgroundColor: '#09090B', padding: 16, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: '#27272A' },
  codeTitle: { color: '#007AFF', fontWeight: 'bold', marginBottom: 10, fontSize: 13 },
  codeText: { color: '#D4D4D8', fontFamily: 'monospace', fontSize: 11, lineHeight: 18 },

  // ADMIN STYLES
  userCard: { backgroundColor: '#18181B', padding: 18, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: '#27272A' },
  userHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  userName: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  userEmail: { color: '#A1A1AA', fontSize: 14, marginBottom: 8 },
  userDevice: { color: '#71717A', fontSize: 12, fontFamily: 'monospace' },
  lastSeen: { color: '#71717A', fontSize: 12, fontStyle: 'italic', marginTop: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  deleteBtn: { backgroundColor: '#270000', padding: 12, borderRadius: 10, marginTop: 16, alignItems: 'center', borderWidth: 1, borderColor: '#ff4444' },
  deleteBtnText: { color: '#ff4444', fontWeight: 'bold', fontSize: 13, letterSpacing: 0.5 }
});

export default App;