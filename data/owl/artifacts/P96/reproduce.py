import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
import glob
import json
import random
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder

def load_data(data_dir):
    all_iq = []
    all_mod = []
    all_snr = []
    
    files = glob.glob(f"{data_dir}/train/groups/*.npz") + glob.glob(f"{data_dir}/validation/groups/*.npz")
    
    for f in files:
        data = np.load(f, allow_pickle=False)
        all_iq.append(data['iq'])
        all_mod.append(data['modulation'])
        all_snr.append(data['snr_db'])
        
    iq = np.concatenate(all_iq, axis=0)
    mod = np.concatenate(all_mod, axis=0)
    snr = np.concatenate(all_snr, axis=0)
    
    return iq, mod, snr

class ComplexConvLayer(nn.Module):
    def __init__(self, in_c, out_c, kernel_size, stride=1, padding=0):
        super().__init__()
        self.in_c = in_c
        self.conv_re = nn.Conv2d(in_c, out_c, kernel_size, stride=stride, padding=padding)
        self.conv_im = nn.Conv2d(in_c, out_c, kernel_size, stride=stride, padding=padding)

    def forward(self, x):
        # x: (B, 2 * in_c, H, W)
        x_re = x[:, :self.in_c, :, :]
        x_im = x[:, self.in_c:, :, :]
        
        out_re = self.conv_re(x_re) - self.conv_im(x_im)
        out_im = self.conv_re(x_im) + self.conv_im(x_re)
        
        return torch.cat([out_re, out_im], dim=1)

class ResidualUnit(nn.Module):
    def __init__(self, c):
        super().__init__()
        self.conv1 = ComplexConvLayer(c, c, 3, padding=1)
        self.conv2 = ComplexConvLayer(c, c, 3, padding=1)
        self.relu = nn.ReLU()

    def forward(self, x):
        identity = x
        out = self.relu(self.conv1(x))
        out = self.relu(self.conv2(out))
        return out + identity

class SimpleDenseResNetC(nn.Module):
    def __init__(self, num_classes):
        super().__init__()
        # First layer: (B, 2, 128, 1) -> (B, 32, 128, 1)
        # in_c = 1, out_c = 16. Output channels = 2 * 16 = 32.
        self.layer1 = ComplexConvLayer(1, 16, 3, padding=1)
        
        self.blocks = nn.ModuleList()
        curr_c = 16
        for _ in range(6):
            block = nn.Sequential()
            for _ in range(4):
                block.add_module(f"unit_{_}", ResidualUnit(curr_c))
            self.blocks.append(block)
            
        self.avgpool = nn.AdaptiveAvgPool2d(1)
        self.fc = nn.Linear(2 * curr_c, num_classes)
        
    def forward(self, x):
        x = self.layer1(x)
        for block in self.blocks:
            x = block(x)
        x = self.avgpool(x)
        x = torch.flatten(x, 1)
        x = self.fc(x)
        return x

def train_and_eval():
    seed = 2020
    torch.manual_seed(seed)
    np.random.seed(seed)
    random.seed(seed)
    
    iq, mod, snr = load_data('data')
    le = LabelEncoder()
    mod_encoded = le.fit_transform(mod)
    num_classes = len(le.classes_)
    
    indices = np.arange(len(iq))
    np.random.shuffle(indices)
    train_idx, test_idx = train_test_split(indices, test_size=0.5, random_state=seed)
    
    X = torch.tensor(iq, dtype=torch.float32).unsqueeze(-1)
    Y = torch.tensor(mod_encoded, dtype=torch.long)
    S = torch.tensor(snr, dtype=torch.int)
    
    train_dataset = TensorDataset(X[train_idx], Y[train_idx])
    test_dataset = TensorDataset(X[test_idx], Y[test_idx], S[test_idx])
    
    train_loader = DataLoader(train_dataset, batch_size=1024, shuffle=True)
    test_loader = DataLoader(test_dataset, batch_size=1024, shuffle=False)
    
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = SimpleDenseResNetC(num_classes).to(device)
    optimizer = optim.Adam(model.parameters(), lr=1e-3)
    criterion = nn.CrossEntropyLoss()
    
    model.train()
    for epoch in range(5): # Very few epochs to stay under 20 mins
        for batch_x, batch_y in train_loader:
            batch_x, batch_y = batch_x.to(device), batch_y.to(device)
            optimizer.zero_grad()
            output = model(batch_x)
            loss = criterion(output, batch_y)
            loss.backward()
            optimizer.step()
            
    model.eval()
    correct = 0
    total = 0
    with torch.no_grad():
        for batch_x, batch_y, batch_s in test_loader:
            batch_x, batch_y, batch_s = batch_x.to(device), batch_y.to(device), batch_s.to(device)
            mask = (batch_s == 12)
            if not mask.any():
                continue
            batch_x, batch_y = batch_x[mask], batch_y[mask]
            output = model(batch_x)
            pred = output.argmax(dim=1)
            correct += (pred == batch_y).sum().item()
            total += batch_y.size(0)
            
    return 100.0 * correct / total if total > 0 else 0

if __name__ == "__main__":
    acc = train_and_eval()
    result = {
        "metric": "classification accuracy at 12 dB SNR",
        "value": acc,
        "unit": "%",
        "split": "50/50 random train/test split",
        "notes": "Simplified Dense ResNet-68 C architecture; trained for 5 epochs due to time limit."
    }
    with open('RESULT.json', 'w') as f:
        json.dump(result, f)
    print(f"Accuracy at 12dB: {acc}%")
