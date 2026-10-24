// The phone's secure storage (Android Keystore / iOS Keychain). The browser
// preview gets secure-store.web.ts instead — Metro picks it by extension.
export { deleteItemAsync, getItemAsync, setItemAsync } from "expo-secure-store";
