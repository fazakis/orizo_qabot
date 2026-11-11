//! Browser adapter for the unchanged, fixture-tested Android/iOS Olm core.
use wasm_bindgen::prelude::*;
#[wasm_bindgen]
pub fn invoke(operation: &str, payload: &str, state: &[u8], key: &[u8]) -> Result<Vec<u8>, JsValue> {
    if key.len()!=32 || operation.len()>64 || payload.len()>4*1024*1024 || state.len()>32*1024*1024 {
        return Err(JsValue::from_str("Invalid encrypted messaging request"));
    }
    let mut length=0usize;
    let pointer=unsafe { orizo_olm_android::orizo_olm_invoke(
        operation.as_ptr(),operation.len(),payload.as_ptr(),payload.len(),
        state.as_ptr(),state.len(),key.as_ptr(),key.len(),&mut length) };
    if pointer.is_null() { return Err(JsValue::from_str("Encryption engine failed")); }
    let bytes=unsafe { std::slice::from_raw_parts(pointer,length) }.to_vec();
    unsafe { orizo_olm_android::orizo_olm_free(pointer,length) };
    Ok(bytes)
}
