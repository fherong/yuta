
#include <Wire.h>
#include <Keypad.h>
#include <LiquidCrystal_I2C.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>

// =====================================================
// Y.U.T.A. - ARDUINO MEGA 2560
// TESTING VERSION
// No physical AUX wiring check
// No IR calculations
// Serial: 9600 baud
// =====================================================

LiquidCrystal_I2C lcd(0x27, 20, 4);

#define SERIAL_BAUD 9600
#define MAX_MOTORS 20
#define MAX_EMPLOYEES 25

struct Motor {
  char id[45];
  char name[35];
  float ratedVoltage;
};

struct Employee {
  char id[45];
  char name[45];
  char idSuffix[4];
};

Motor motors[MAX_MOTORS];
Employee employees[MAX_EMPLOYEES];

int motorCount = 0;
int selectedMotor = 0;
int employeeCount = 0;
int selectedEmployee = 0;

bool readyScreenShown = false;
bool operatorLoggedIn = false;

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
float measuredVoltage = 0;

const char* measurementNames[6] = {
  "L1-L2",
  "L2-L3",
  "L3-L1",
  "L1-G",
  "L2-G",
  "L3-G"
};

char employeeId[50] = "N/A";
char operatorName[50] = "Arduino Operator";

// =====================================================
// LCD FUNCTIONS
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

  strncpy(
    motors[motorCount].id,
    id,
    sizeof(motors[motorCount].id) - 1
  );

  motors[motorCount].id[
    sizeof(motors[motorCount].id) - 1
  ] = '\0';

  strncpy(
    motors[motorCount].name,
    name,
    sizeof(motors[motorCount].name) - 1
  );

  motors[motorCount].name[
    sizeof(motors[motorCount].name) - 1
  ] = '\0';

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
      }
      else if (index < sizeof(buffer) - 1) {
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
    lcd.print(
      String(motors[motorIndex].name).substring(0, 15)
    );
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
// EMPLOYEE LOGIN
// =====================================================

void processEmployeeLine(char* line) {
  if (strncmp(line, "EMPLOYEE|", 9) != 0) return;
  if (employeeCount >= MAX_EMPLOYEES) return;

  char* id = line + 9;
  char* name = strchr(id, '|');
  if (!name) return;
  *name = '\0';
  name++;

  char* idSuffix = strchr(name, '|');
  if (!idSuffix) return;
  *idSuffix = '\0';
  idSuffix++;

  if (strlen(id) == 0 || strlen(name) == 0) return;

  for (int i = 0; i < employeeCount; i++) {
    if (strcmp(employees[i].id, id) == 0) return;
  }

  strncpy(employees[employeeCount].id, id, sizeof(employees[employeeCount].id) - 1);
  employees[employeeCount].id[sizeof(employees[employeeCount].id) - 1] = '\0';

  strncpy(employees[employeeCount].name, name, sizeof(employees[employeeCount].name) - 1);
  employees[employeeCount].name[sizeof(employees[employeeCount].name) - 1] = '\0';

  strncpy(employees[employeeCount].idSuffix, idSuffix, sizeof(employees[employeeCount].idSuffix) - 1);
  employees[employeeCount].idSuffix[sizeof(employees[employeeCount].idSuffix) - 1] = '\0';

  employeeCount++;
}

bool requestEmployeeList() {
  employeeCount = 0;

  showMessage(
    "EMPLOYEE LOGIN",
    "Connecting to Pi...",
    "Loading eligible staff",
    "Please wait..."
  );

  Serial.println("EMPLOYEES?");

  unsigned long startTime = millis();
  char buffer[150];
  int index = 0;
  bool receivedEnd = false;
  bool unavailable = false;

  while (millis() - startTime < 15000) {
    while (Serial.available()) {
      char c = Serial.read();

      if (c == '\n' || c == '\r') {
        if (index == 0) continue;

        buffer[index] = '\0';
        index = 0;

        if (strcmp(buffer, "END") == 0) {
          receivedEnd = true;
          break;
        }

        if (strncmp(buffer, "EMPLOYEE_ERROR|", 15) == 0) {
          unavailable = true;
        } else {
          processEmployeeLine(buffer);
        }
      } else if (index < sizeof(buffer) - 1) {
        buffer[index++] = c;
      }
    }

    if (receivedEnd) break;
  }

  if (!receivedEnd || unavailable || employeeCount == 0) {
    if (!receivedEnd) {
      showMessage(
        "PI NOT RESPONDING",
        "Check gateway/cable",
        "Check SERIAL_PORT",
        "Press A to retry"
      );
    } else if (unavailable) {
      showMessage(
        "FIREBASE UNAVAILABLE",
        "Check network/auth",
        "Pi gateway connection",
        "Press A to retry"
      );
    } else {
      showMessage(
        "NO ELIGIBLE STAFF",
        "PIN must be 8-12",
        "numeric digits only",
        "Reset in website"
      );
    }

    delay(1500);
    return false;
  }

  selectedEmployee = 0;
  return true;
}

void displayEmployeeList() {
  lcd.clear();

  int startIndex = (selectedEmployee / 3) * 3;
  lcd.setCursor(0, 0);
  lcd.print("A:N B:P #:OK C:BACK");

  for (int row = 0; row < 3; row++) {
    int employeeIndex = startIndex + row;
    lcd.setCursor(0, row + 1);
    lcd.print("                    ");

    if (employeeIndex >= employeeCount) continue;

    lcd.setCursor(0, row + 1);
    lcd.print(employeeIndex == selectedEmployee ? ">" : " ");
    lcd.print(String(employees[employeeIndex].name).substring(0, 13));
    lcd.setCursor(14, row + 1);
    lcd.print("ID:");
    lcd.print(employees[employeeIndex].idSuffix);
  }
}

int selectEmployee() {
  while (employeeCount > 0) {
    displayEmployeeList();
    char key = keypad.getKey();
    if (!key) continue;

    if (key == 'A') {
      selectedEmployee = (selectedEmployee + 1) % employeeCount;
    } else if (key == 'B') {
      selectedEmployee = (selectedEmployee + employeeCount - 1) % employeeCount;
    } else if (key == '#') {
      return selectedEmployee;
    } else if (key == 'C') {
      return -1;
    } else if (key == 'D') {
      return requestEmployeeList() ? selectedEmployee : -1;
    }
  }

  return -1;
}

bool waitForEmployeeLoginResponse() {
  unsigned long startTime = millis();
  char buffer[80];
  int index = 0;

  while (millis() - startTime < 15000) {
    while (Serial.available()) {
      char c = Serial.read();

      if (c == '\n' || c == '\r') {
        if (index == 0) continue;

        buffer[index] = '\0';
        index = 0;
        if (strcmp(buffer, "LOGIN|OK") == 0) return true;
        if (strcmp(buffer, "LOGIN|ERROR") == 0) return false;
      } else if (index < sizeof(buffer) - 1) {
        buffer[index++] = c;
      }
    }
  }

  return false;
}

bool loginOperator() {
  operatorLoggedIn = false;
  strcpy(employeeId, "N/A");
  strcpy(operatorName, "Arduino Operator");

  if (!requestEmployeeList()) return false;

  int employeeIndex = selectEmployee();
  if (employeeIndex < 0) return false;

  for (int attempt = 1; attempt <= 3; attempt++) {
    String pin = "";
    bool retryPin = false;

    while (!retryPin) {
      String pinMask = "";
      for (unsigned int i = 0; i < pin.length(); i++) pinMask += '*';

      showMessage(
        "PIN: " + String(employees[employeeIndex].name).substring(0, 15),
        "ID ending: " + String(employees[employeeIndex].idSuffix),
        "PIN: " + pinMask,
        "# OK * DEL D BACK"
      );

      char key = keypad.getKey();
      if (!key) continue;

      if (key >= '0' && key <= '9') {
        if (pin.length() < 12) pin += key;
      } else if (key == '*') {
        if (pin.length() > 0) pin.remove(pin.length() - 1);
      } else if (key == 'D') {
        pin.remove(0);
        return false;
      } else if (key == '#') {
        if (pin.length() < 8 || pin.length() > 12) {
          showMessage("PIN MUST BE 8-12", "Enter digits only");
          delay(1000);
          continue;
        }

        Serial.print("LOGIN|");
        Serial.print(employees[employeeIndex].id);
        Serial.print("|");
        Serial.println(pin);
        pin.remove(0);

        showMessage("VERIFYING PIN", "Please wait...");
        if (waitForEmployeeLoginResponse()) {
          strncpy(employeeId, employees[employeeIndex].id, sizeof(employeeId) - 1);
          employeeId[sizeof(employeeId) - 1] = '\0';
          strncpy(operatorName, employees[employeeIndex].name, sizeof(operatorName) - 1);
          operatorName[sizeof(operatorName) - 1] = '\0';
          operatorLoggedIn = true;
          showMessage(
            "LOGIN SUCCESSFUL",
            String(operatorName).substring(0, 20),
            "Operator confirmed"
          );
          delay(1500);
          return true;
        }

        retryPin = true;
        showMessage(
          "LOGIN FAILED",
          "Incorrect PIN or",
          "Pi connection error",
          "Try " + String(attempt) + " of 3"
        );
        delay(1500);
      }
    }
  }

  return false;
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
    lcd.print("                    ");

    lcd.setCursor(0, 1);
    lcd.print("Value: " + input);

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
        if (input.length() == 0) {
          input = "0.";
        } else {
          input += '.';
        }
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

      showMessage(
        "INVALID VALUE",
        "Enter a valid number"
      );

      delay(1000);
    }
    else if (key == 'D') {
      return false;
    }
  }
}

// =====================================================
// SAFETY CONFIRMATION - TESTING ONLY
// No physical AUX input check
// =====================================================

bool verifySafety(bool &auxSafe, bool &voltageSafe) {
  auxSafe = false;
  voltageSafe = false;

  // STEP 1: NC AUXILIARY CONFIRMATION

  showMessage(
    "NC AUXILIARY CHECK",
    "Is NC contact CLOSED?",
    "Contactor must be OFF",
    "A=YES D=NO"
  );

  while (true) {
    char key = keypad.getKey();

    if (key == 'A') {
      auxSafe = true;

      showMessage(
        "AUXILIARY CONFIRMED",
        "Operator selected YES",
        "Proceeding..."
      );

      Serial.println("AUX|YES");

      delay(1500);
      break;
    }

    else if (key == 'D') {
      auxSafe = false;

      showMessage(
        "AUX CHECK FAILED",
        "Operator selected NO",
        "Testing blocked"
      );

      Serial.println("AUX|NO");

      delay(2000);
      return false;
    }
  }

  // STEP 2: MANUAL VOLTAGE INPUT

  showMessage(
    "VOLTAGE VERIFICATION",
    "Use rated voltmeter",
    "Measure motor terminals",
    "Enter voltage (V)"
  );

  delay(1500);

  measuredVoltage = 0;

  if (!readNumber("MEASURED VOLTAGE", measuredVoltage)) {
    voltageSafe = false;
    return false;
  }

  // STEP 3: VOLTAGE ACCEPTANCE

  if (measuredVoltage <= 1.00) {
    voltageSafe = true;

    showMessage(
      "VOLTAGE ACCEPTED",
      "Measured:",
      String(measuredVoltage, 2) + " V",
      "Proceeding..."
    );

    Serial.print("VOLTAGE|");
    Serial.println(measuredVoltage, 2);

    delay(2000);
  }
  else {
    voltageSafe = false;

    showMessage(
      "VOLTAGE TOO HIGH",
      "Measured:",
      String(measuredVoltage, 2) + " V",
      "Testing blocked"
    );

    Serial.print("VOLTAGE|");
    Serial.println(measuredVoltage, 2);

    delay(2500);
    return false;
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

// =====================================================
// TEST EVENTS
// =====================================================

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

  json += "\"motorId\":\"";
  json += jsonEscape(motors[selectedMotor].id);
  json += "\",";

  json += "\"motorName\":\"";
  json += jsonEscape(motors[selectedMotor].name);
  json += "\",";

  json += "\"motorVoltage\":";
  json += String(motors[selectedMotor].ratedVoltage, 2);
  json += ",";

  json += "\"ncAuxSafe\":";
  json += auxSafe ? "true," : "false,";

  json += "\"zeroVoltageSafe\":";
  json += voltageSafe ? "true," : "false,";

  json += "\"measuredVoltage\":";
  json += String(measuredVoltage, 2);
  json += ",";

  json += "\"employeeId\":\"";
  json += jsonEscape(employeeId);
  json += "\",";

  json += "\"operatorName\":\"";
  json += jsonEscape(operatorName);
  json += "\"";

  json += "}";

  Serial.println(json);
}

// =====================================================
// TEST RECORD
// Sends the original entered readings without
// calculating minimum, average, or threshold values.
// =====================================================

void sendTestRecord(
  bool auxSafe,
  bool voltageSafe,
  float testVoltage
) {
  String json = "{";

  json += "\"motorId\":\"";
  json += jsonEscape(motors[selectedMotor].id);
  json += "\",";

  json += "\"motorName\":\"";
  json += jsonEscape(motors[selectedMotor].name);
  json += "\",";

  json += "\"motorVoltage\":";
  json += String(motors[selectedMotor].ratedVoltage, 2);
  json += ",";

  json += "\"testVoltage\":";
  json += String(testVoltage, 2);
  json += ",";

  json += "\"ncAuxSafe\":";
  json += auxSafe ? "true," : "false,";

  json += "\"zeroVoltageSafe\":";
  json += voltageSafe ? "true," : "false,";

  json += "\"measuredVoltage\":";
  json += String(measuredVoltage, 2);
  json += ",";

  const char* fields[6] = {
    "raw_ab",
    "raw_bc",
    "raw_ca",
    "raw_ag",
    "raw_bg",
    "raw_cg"
  };

  for (int i = 0; i < 6; i++) {
    json += "\"";
    json += fields[i];
    json += "\":";
    json += String(irValues[i], 3);

    if (i < 5) {
      json += ",";
    }
  }

  json += ",\"employeeId\":\"";
  json += jsonEscape(employeeId);
  json += "\",";

  json += "\"operatorName\":\"";
  json += jsonEscape(operatorName);
  json += "\"";

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
    showMessage(
      "INVALID TEST VOLTAGE",
      "Must be above zero"
    );

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
// DISPLAY RAW MEASUREMENTS
// No calculations are performed.
// A = Next reading
// D = Save readings
// C = Re-enter readings
// =====================================================

bool confirmMeasurements() {
  int currentReading = 0;

  while (true) {
    showMessage(
      "READING " + String(currentReading + 1) + "/6",
      String(measurementNames[currentReading]),
      String(irValues[currentReading], 3) + " MOhm",
      "A:NEXT D:SAVE C:RETRY"
    );

    char key = keypad.getKey();

    if (key == 'A') {
      currentReading++;

      if (currentReading >= 6) {
        currentReading = 0;
      }
    }
    else if (key == 'D') {
      return true;
    }
    else if (key == 'C') {
      return false;
    }
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
  if (!operatorLoggedIn) return;

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

  // INITIAL SAFETY CONFIRMATION

  if (!verifySafety(auxSafe, voltageSafe)) {
    showMessage(
      "SAFETY CHECK FAILED",
      "Testing blocked"
    );

    sendSafetyFailure(auxSafe, voltageSafe);

    waitForAcknowledgement();

    delay(2000);
    return;
  }

  showMessage(
    "SAFETY CONFIRMED",
    "Use UT510A manually",
    "Enter readings next"
  );

  delay(2000);

  sendOcrTestStarted();

  float testVoltage = 0;

  // MEASUREMENT ENTRY AND REVIEW

  while (true) {
    if (!enterMeasurements(testVoltage)) {
      sendOcrTestCancelled();

      showMessage(
        "TEST CANCELLED",
        "No record submitted"
      );

      delay(1500);
      return;
    }

    if (confirmMeasurements()) {
      break;
    }

    showMessage(
      "RE-ENTER READINGS",
      "Restarting..."
    );

    delay(1000);
  }

  // FINAL SAFETY CONFIRMATION

  showMessage(
    "FINAL SAFETY CHECK",
    "Turn tester OFF",
    "Discharge motor",
    "Verify with meter"
  );

  delay(2000);

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

  // TRANSMIT ORIGINAL INPUT VALUES

  sendTestRecord(
    auxSafe,
    voltageSafe,
    testVoltage
  );

  showMessage(
    "RECORD TRANSMITTED",
    "Waiting for Pi..."
  );

  if (waitForAcknowledgement()) {
    showMessage(
      "RECORD SAVED",
      "Saved on Pi",
      "Cloud sync complete",
      "Test completed"
    );
  }
  else {
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

  lcd.init();
  lcd.backlight();

  showMessage(
    "Y.U.T.A.",
    "Insulation Monitor",
    "Initializing..."
  );

  delay(1500);

  loginOperator();
  requestMotorList();
}

// =====================================================
// LOOP
// =====================================================

void loop() {
  if (!operatorLoggedIn) {
    if (!readyScreenShown) {
      showMessage(
        "LOGIN REQUIRED",
        "A = Login",
        "No tests allowed",
        "without operator"
      );
      readyScreenShown = true;
    }

    char loginKey = keypad.getKey();
    if (loginKey == 'A' || loginKey == 'D') {
      readyScreenShown = false;
      loginOperator();
    }
    return;
  }

  if (motorCount == 0) {
    if (!readyScreenShown) {
      showMessage(
        "NO MOTORS FOUND",
        "Check Pi connection",
        "D = Retry motor list",
        "C = Change user"
      );

      readyScreenShown = true;
    }

    char key = keypad.getKey();

    if (key == 'D') {
      readyScreenShown = false;
      requestMotorList();
    }
    else if (key == 'C') {
      operatorLoggedIn = false;
      readyScreenShown = false;
      loginOperator();
    }

    return;
  }

  if (!readyScreenShown) {
    showMessage(
      "Y.U.T.A. READY",
      "User: " + String(operatorName).substring(0, 14),
      "A=START D=MOTORS",
      "C=CHANGE USER"
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
  else if (key == 'C') {
    operatorLoggedIn = false;
    readyScreenShown = false;
    loginOperator();
  }
}