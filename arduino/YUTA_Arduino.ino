#include <Wire.h>
#include <Keypad.h>
#include <LiquidCrystal_I2C.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>


// =====================================================
// Y.U.T.A. - ARDUINO MEGA 2560
// Serial protocol: 9600 baud
// =====================================================


LiquidCrystal_I2C lcd(0x27, 20, 4);


#define SERIAL_BAUD 9600
#define AUX_PIN 23
#define MAX_MOTORS 20


struct Motor {
  char id[45];
  char name[35];
  float ratedVoltage;
};


Motor motors[MAX_MOTORS];


int motorCount = 0;
int selectedMotor = 0;


bool readyScreenShown = false;


const byte ROWS = 4;
const byte COLS = 4;


char keys[ROWS][COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};


byte rowPins[ROWS] = {41, 40, 39, 38};
byte colPins[COLS] = {37, 36, 35, 34};


Keypad keypad = Keypad(
  makeKeymap(keys),
  rowPins,
  colPins,
  ROWS,
  COLS
);


float irValues[6];


const char* measurementNames[6] = {
  "L1-L2",
  "L2-L3",
  "L3-L1",
  "L1-G",
  "L2-G",
  "L3-G"
};


char employeeId[35] = "N/A";
char operatorName[50] = "Arduino Operator";


// =====================================================
// LCD
// =====================================================


void showMessage(
  String line1,
  String line2 = "",
  String line3 = "",
  String line4 = ""
) {
  lcd.clear();


  lcd.setCursor(0, 0);
  lcd.print(line1.substring(0, 20));


  lcd.setCursor(0, 1);
  lcd.print(line2.substring(0, 20));


  lcd.setCursor(0, 2);
  lcd.print(line3.substring(0, 20));


  lcd.setCursor(0, 3);
  lcd.print(line4.substring(0, 20));
}


// =====================================================
// SERIAL MOTOR LIST
// =====================================================


void processMotorLine(char* line) {
  if (strncmp(line, "MOTOR|", 6) != 0) return;


  if (motorCount >= MAX_MOTORS) return;


  char* id = line + 6;
  char* name = strchr(id, '|');


  if (!name) return;


  *name = '\0';
  name++;


  char* voltage = strchr(name, '|');


  if (!voltage) return;


  *voltage = '\0';
  voltage++;


  if (strlen(id) == 0 || strlen(name) == 0) return;


  for (int i = 0; i < motorCount; i++) {
    if (strcmp(motors[i].id, id) == 0) return;
  }


  strncpy(motors[motorCount].id, id, sizeof(motors[motorCount].id) - 1);
  motors[motorCount].id[sizeof(motors[motorCount].id) - 1] = '\0';


  strncpy(motors[motorCount].name, name, sizeof(motors[motorCount].name) - 1);
  motors[motorCount].name[sizeof(motors[motorCount].name) - 1] = '\0';


  motors[motorCount].ratedVoltage = atof(voltage);


  motorCount++;
}


void requestMotorList() {
  motorCount = 0;


  showMessage(
    "Y.U.T.A.",
    "Connecting to Pi...",
    "Retrieving motors",
    "Please wait..."
  );


  Serial.println("LIST?");


  unsigned long startTime = millis();


  char buffer[150];
  int index = 0;
  bool receivedEnd = false;


  while (millis() - startTime < 15000) {
    while (Serial.available()) {
      char c = Serial.read();


      if (c == '\n' || c == '\r') {
        if (index > 0) {
          buffer[index] = '\0';


          if (strcmp(buffer, "END") == 0) {
            receivedEnd = true;
            index = 0;
            break;
          }


          processMotorLine(buffer);
          index = 0;
        }
      } else if (index < sizeof(buffer) - 1) {
        buffer[index++] = c;
      }
    }


    if (receivedEnd) break;
  }


  if (!receivedEnd) {
    showMessage(
      "CONNECTION TIMEOUT",
      "No response from Pi",
      "Press D to retry"
    );
    delay(1500);
    return;
  }


  selectedMotor = 0;


  if (motorCount == 0) {
    showMessage(
      "NO MOTORS FOUND",
      "Check Firebase",
      "Check Pi gateway",
      "Press D to retry"
    );
    delay(1500);
    return;
  }


  showMessage(
    "MOTOR LIST UPDATED",
    "Motors received:",
    String(motorCount)
  );


  delay(1200);
}


// =====================================================
// MOTOR SELECTION
// =====================================================


void displayMotorList() {
  lcd.clear();


  int startIndex = (selectedMotor / 3) * 3;


  lcd.setCursor(0, 0);
  lcd.print("A:N B:P #:OK D:REF");


  for (int row = 0; row < 3; row++) {
    int motorIndex = startIndex + row;


    lcd.setCursor(0, row + 1);
    lcd.print("                    ");


    if (motorIndex >= motorCount) continue;


    lcd.setCursor(0, row + 1);


    lcd.print(motorIndex == selectedMotor ? ">" : " ");
    lcd.print(motorIndex + 1);
    lcd.print(". ");
    lcd.print(String(motors[motorIndex].name).substring(0, 15));
  }
}


int selectMotor() {
  if (motorCount == 0) {
    requestMotorList();
  }


  if (motorCount == 0) return -1;


  while (true) {
    displayMotorList();


    char key = keypad.getKey();


    if (!key) continue;


    if (key == 'A') {
      selectedMotor++;


      if (selectedMotor >= motorCount) {
        selectedMotor = 0;
      }
    }


    else if (key == 'B') {
      selectedMotor--;


      if (selectedMotor < 0) {
        selectedMotor = motorCount - 1;
      }
    }


    else if (key == '#') {
      return selectedMotor;
    }


    else if (key == 'D') {
      requestMotorList();


      if (motorCount == 0) return -1;
    }


    else if (key == 'C') {
      return -1;
    }
  }
}


// =====================================================
// NUMERIC INPUT
// # = Confirm
// * = Backspace
// A = Decimal
// D = Cancel
// =====================================================


bool readNumber(String prompt, float &value) {
  String input = "";


  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(prompt.substring(0, 20));


  while (true) {
    lcd.setCursor(0, 1);
    lcd.print("Value:              ");
    lcd.setCursor(7, 1);
    lcd.print(input);


    lcd.setCursor(0, 3);
    lcd.print("# OK * DEL D CANCEL");


    char key = keypad.getKey();


    if (!key) continue;


    if (key >= '0' && key <= '9') {
      if (input.length() < 10) {
        input += key;
      }
    }


    else if (key == 'A') {
      if (input.indexOf('.') == -1) {
        input += '.';
      }
    }


    else if (key == '*') {
      if (input.length() > 0) {
        input.remove(input.length() - 1);
      }
    }


    else if (key == '#') {
      if (input.length() > 0) {
        value = input.toFloat();


        if (isfinite(value) && value >= 0) {
          return true;
        }
      }


      showMessage("INVALID VALUE", "Enter a valid number");
      delay(1000);
    }


    else if (key == 'D') {
      return false;
    }
  }
}


// =====================================================
// SAFETY VERIFICATION
// =====================================================


bool verifySafety(bool &auxSafe, bool &voltageSafe) {
  auxSafe = (digitalRead(AUX_PIN) == LOW);


  showMessage(
    "AUX CONTACT CHECK",
    auxSafe ? "NC CONTACT: CLOSED" : "NC CONTACT: OPEN",
    auxSafe ? "Contactor OFF" : "UNSAFE CONDITION"
  );


  delay(1500);


  if (!auxSafe) {
    voltageSafe = false;
    return false;
  }


  showMessage(
    "VOLTAGE VERIFICATION",
    "Use rated voltmeter",
    "Verify ZERO voltage",
    "A=YES D=NO"
  );


  while (true) {
    char key = keypad.getKey();


    if (key == 'A') {
      voltageSafe = true;
      break;
    }


    if (key == 'D') {
      voltageSafe = false;
      break;
    }
  }


  return auxSafe && voltageSafe;
}


// =====================================================
// JSON ESCAPING
// =====================================================


String jsonEscape(const char* input) {
  String output = "";


  while (*input) {
    char c = *input++;


    if (c == '"' || c == '\\') {
      output += '\\';
      output += c;
    }


    else if (c == '\n') {
      output += "\\n";
    }


    else if (c == '\r') {
      output += "\\r";
    }


    else if ((unsigned char)c >= 32) {
      output += c;
    }
  }


  return output;
}


void sendOcrTestStarted() {
  String json = "{\"event\":\"test_started\",\"motorId\":\"";
  json += jsonEscape(motors[selectedMotor].id);
  json += "\"}";
  Serial.println(json);
}

void sendOcrTestCancelled() {
  String json = "{\"event\":\"test_cancelled\",\"motorId\":\"";
  json += jsonEscape(motors[selectedMotor].id);
  json += "\"}";
  Serial.println(json);
}


// =====================================================
// SAFETY FAILURE RECORD
// =====================================================


void sendSafetyFailure(bool auxSafe, bool voltageSafe) {
  String json = "{";


  json += "\"motorId\":\"" + jsonEscape(motors[selectedMotor].id) + "\",";
  json += "\"motorName\":\"" + jsonEscape(motors[selectedMotor].name) + "\",";
  json += "\"motorVoltage\":" + String(motors[selectedMotor].ratedVoltage, 2) + ",";
  json += "\"ncAuxSafe\":";
  json += auxSafe ? "true," : "false,";
  json += "\"zeroVoltageSafe\":";
  json += voltageSafe ? "true," : "false,";
  json += "\"employeeId\":\"" + jsonEscape(employeeId) + "\",";
  json += "\"operatorName\":\"" + jsonEscape(operatorName) + "\"";


  json += "}";


  Serial.println(json);
}


// =====================================================
// TEST RECORD
// =====================================================


void sendTestRecord(
  bool auxSafe,
  bool voltageSafe,
  float testVoltage
) {
  String json = "{";


  json += "\"motorId\":\"" + jsonEscape(motors[selectedMotor].id) + "\",";
  json += "\"motorName\":\"" + jsonEscape(motors[selectedMotor].name) + "\",";
  json += "\"motorVoltage\":" + String(motors[selectedMotor].ratedVoltage, 2) + ",";
  json += "\"testVoltage\":" + String(testVoltage, 2) + ",";
  json += "\"ncAuxSafe\":";
  json += auxSafe ? "true," : "false,";
  json += "\"zeroVoltageSafe\":";
  json += voltageSafe ? "true," : "false,";


  const char* fields[6] = {
    "raw_ab", "raw_bc", "raw_ca",
    "raw_ag", "raw_bg", "raw_cg"
  };


  for (int i = 0; i < 6; i++) {
    json += "\"" + String(fields[i]) + "\":";
    json += String(irValues[i], 3);


    if (i < 5) json += ",";
  }


  json += ",\"employeeId\":\"" + jsonEscape(employeeId) + "\",";
  json += "\"operatorName\":\"" + jsonEscape(operatorName) + "\"";


  json += "}";


  Serial.println(json);
}


// =====================================================
// MANUAL MEASUREMENT ENTRY
// =====================================================


bool enterMeasurements(float &testVoltage) {
  if (!readNumber("TEST VOLTAGE (V)", testVoltage)) {
    return false;
  }


  if (testVoltage <= 0) {
    showMessage("INVALID TEST VOLTAGE");
    delay(1000);
    return false;
  }


  for (int i = 0; i < 6; i++) {
    float reading = 0;


    String prompt = String(measurementNames[i]) + " (MOhm)";


    if (!readNumber(prompt, reading)) {
      return false;
    }


    irValues[i] = reading;
  }


  return true;
}


// =====================================================
// REVIEW MEASUREMENTS
// =====================================================


bool confirmMeasurements() {
  float minimumIR = irValues[0];


  for (int i = 1; i < 6; i++) {
    if (irValues[i] < minimumIR) {
      minimumIR = irValues[i];
    }
  }


  showMessage(
    "MEASUREMENTS DONE",
    "Minimum IR:",
    String(minimumIR, 3) + " MOhm",
    "A=SAVE D=RETRY"
  );


  while (true) {
    char key = keypad.getKey();


    if (key == 'A') return true;
    if (key == 'D') return false;
  }
}


// =====================================================
// WAIT FOR PI ACKNOWLEDGEMENT
// =====================================================


bool waitForAcknowledgement() {
  unsigned long startTime = millis();


  char buffer[100];
  int index = 0;


  while (millis() - startTime < 10000) {
    while (Serial.available()) {
      char c = Serial.read();


      if (c == '\n' || c == '\r') {
        if (index == 0) continue;


        buffer[index] = '\0';
        index = 0;


        if (strcmp(buffer, "ACK|SAVED") == 0) {
          return true;
        }


        if (strncmp(buffer, "ACK|ERROR", 9) == 0) {
          return false;
        }
      }


      else if (index < sizeof(buffer) - 1) {
        buffer[index++] = c;
      }
    }
  }


  return false;
}


// =====================================================
// MAIN TEST WORKFLOW
// =====================================================


void performTest() {
  int motorIndex = selectMotor();


  if (motorIndex < 0) return;


  selectedMotor = motorIndex;


  bool auxSafe = false;
  bool voltageSafe = false;


  showMessage(
    "SELECTED MOTOR:",
    motors[selectedMotor].name,
    "Rated voltage:",
    String(motors[selectedMotor].ratedVoltage, 0) + " V"
  );


  delay(2000);


  if (!verifySafety(auxSafe, voltageSafe)) {
    showMessage(
      "SAFETY CHECK FAILED",
      "Testing blocked",
      "Check isolation"
    );


    sendSafetyFailure(auxSafe, voltageSafe);


    waitForAcknowledgement();


    delay(2000);
    return;
  }


  showMessage(
    "SAFETY VERIFIED",
    "Use UT501A manually",
    "Enter readings next"
  );


  delay(2000);
  sendOcrTestStarted();


  float testVoltage = 0;


  // Allow measurement retry without restarting motor selection.
  while (true) {
    if (!enterMeasurements(testVoltage)) {
      sendOcrTestCancelled();
      showMessage("TEST CANCELLED", "No record submitted");
      delay(1500);
      return;
    }


    if (confirmMeasurements()) {
      break;
    }


    showMessage("RE-ENTER READINGS", "Restarting...");
    delay(1000);
  }


  // Recheck the physical interlock and obtain a fresh
  // operator zero-voltage confirmation before saving.
  showMessage(
    "FINAL SAFETY CHECK",
    "Confirm tester is off",
    "And motor discharged"
  );


  delay(1500);


  if (!verifySafety(auxSafe, voltageSafe)) {
    showMessage(
      "SAFETY CHECK FAILED",
      "Record blocked"
    );


    sendSafetyFailure(auxSafe, voltageSafe);
    waitForAcknowledgement();


    delay(2000);
    return;
  }


  sendTestRecord(auxSafe, voltageSafe, testVoltage);


  showMessage(
    "RECORD TRANSMITTED",
    "Waiting for Pi..."
  );


  if (waitForAcknowledgement()) {
    showMessage(
      "RECORD SAVED",
      "Saved on Pi",
      "Cloud sync may wait",
      "Test completed"
    );
  } else {
    showMessage(
      "SAVE NOT CONFIRMED",
      "Check Pi gateway",
      "Check Firebase"
    );
  }


  delay(2500);
}


// =====================================================
// SETUP
// =====================================================


void setup() {
  Serial.begin(SERIAL_BAUD);


  pinMode(AUX_PIN, INPUT_PULLUP);


  lcd.init();
  lcd.backlight();


  showMessage(
    "Y.U.T.A.",
    "Insulation Monitor",
    "Initializing..."
  );


  delay(1500);


  requestMotorList();
}


// =====================================================
// LOOP
// =====================================================


void loop() {
  if (motorCount == 0) {
    if (!readyScreenShown) {
      showMessage(
        "NO MOTORS FOUND",
        "Check Pi connection",
        "Press D to retry"
      );


      readyScreenShown = true;
    }


    char key = keypad.getKey();


    if (key == 'D') {
      readyScreenShown = false;
      requestMotorList();
    }


    return;
  }


  if (!readyScreenShown) {
    showMessage(
      "Y.U.T.A. READY",
      "Motors: " + String(motorCount),
      "A = Start Test",
      "D = Refresh List"
    );


    readyScreenShown = true;
  }


  char key = keypad.getKey();


  if (key == 'A') {
    readyScreenShown = false;
    performTest();
  }


  else if (key == 'D') {
    readyScreenShown = false;
    requestMotorList();
  }
}